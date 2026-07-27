# Bulk Assignment CST CSV Contract

Bulk assignment import stores all CST-related data, calculates CST readiness, and does not submit data to CST automatically. CST submission remains a separate action from the CST Sync Monitor.

## Required Columns

| CSV column | Database field | CST payload field | Applies to | Status | Validation rule |
|---|---|---|---|---|---|
| assignmentType | assignment_target_type, assignment_status_id | assignmentStatusId | All | Mandatory | BUSINESS or INTERNAL. Legacy status 3/2 is still accepted. |
| cidr | cidr | ipSubnet | All | Conditional | Required unless startIp/endIp/size supplied. Must be valid CIDR. |
| startIp | cidr via range split | ipSubnet | All | Conditional | Required with endIp and size when cidr is blank. |
| endIp | cidr via range split | ipSubnet | All | Conditional | Required with startIp and size when cidr is blank. |
| size | size | derived | All | Conditional | Required for ranges; optional CIDR size consistency check. |
| status | assignment_status_id | assignmentStatusId | All | Mandatory | 3 Business or 2 Internal for CST migration import. |
| assignmentDate | assignment_date | assignmentDate | All | Mandatory | Required; formatted by CST payload service. |
| customerName | customer_name | organizationName fallback | All | Mandatory | Required for Business; internal owner/display name for Internal. |
| serviceId | service_id, service_instance_id | service key/preserved | Business | Mandatory | Required for Business. |
| serviceDescription | service_description, service | serviceDescription | All | Mandatory for Internal | Required for Internal; recommended for Business. |
| organizationName | organization_name | organizationName | Business | Mandatory | Required for Business. |
| organizationId | organization_id | organizationId | Business | Conditional | Must be 10 digits when supplied; filled from commercialRegId/unifiedNumber if blank. |
| commercialRegId | commercial_reg_id | source for organizationId | Business | Conditional | Must be 10 digits when supplied. |
| unifiedNumber | unified_number | source for organizationId | Business | Conditional | Must be 10 digits when supplied. |
| customerTypeId | customer_type_id | customerTypeId | Business | Mandatory | Must map to CST 1 Government or 2 Non-Government. |
| regionId | region_id | regionId | Business/Internal | Mandatory | Must map to CST region lookup for Business; required directly or as region for Internal. |
| cityId | city_id | cityId | Business/Internal | Conditional | Must map to CST city lookup when supplied; required directly or as city for Internal. |
| fullName | full_name | contact.fullName | Business/Internal | Mandatory | Required for Business; fullName or contactName required for Internal. |
| mobileNumber | mobile_number | contact.mobileNumber | Business/Internal | Mandatory | Saudi mobile/landline format or normalized to approved fallback 0000000000 with warning/audit. |
| idNumber | id_number | contact.idNumber | Business | Mandatory | Must be 10 digits for CST-ready Business rows. |
| email | email | contact.email | Business/Internal | Mandatory | Must be valid email. |
| contactName | contact_name | contact fallback | Business/Internal | Conditional | Used when fullName is blank. |
| contactNumber | contact_number | mobile fallback | Business/Internal | Conditional | Used when mobileNumber is blank; invalid value normalized to 0000000000 with warning/audit. |
| contactEmail | contact_email | email fallback | Business/Internal | Conditional | Used when email is blank. |
| customerId | customer_id, bss_customer_id | preserved | Business | Mandatory | Preserved for BSS traceability; serviceId remains the reliable CST/BSS matching key. |
| accessTechnologyId | access_technology_id | accessTechnologyId | Business/Internal | Optional | If supplied, must map to CST access technology lookup. |
| owner | owner | local owner | Internal | Mandatory | Required for Internal readiness. |
| assignmentPurpose | assignment_purpose | serviceDescription fallback/local purpose | Internal | Mandatory | Required for Internal readiness. |
| site | site | local address/site | Internal | Mandatory | Site or locationName required for Internal readiness. |
| city | city | city mapping hint | Business/Internal | Conditional | If supplied without cityId and mapping fails, row is not CST-ready. |
| region | region | region mapping hint | Business/Internal | Conditional | If supplied without regionId and mapping fails, row is not CST-ready. |
| notes | notes | description | All | Optional | Exported to local description/notes. |

## Import Results

Each imported assignment stores:

- cst_sync_ready
- cst_validation_status
- cst_validation_errors
- cst_validation_warnings

The downloadable bulk report includes:

- Ready for CST sync
- Imported but not ready for CST sync
- Rejected

Invalid mobile/contact numbers are normalized to `0000000000` and recorded as row warnings plus audit events.
## Conflict handling during migration

Bulk assignment import allows overlapping but non-identical CIDR ranges to be imported as migration conflicts. These rows are stored with `cstSyncReady=false`, `cstValidationStatus=CONFLICT`, and the overlap reason in the validation errors. They do not create CST sync jobs during import.

Use **Integrity & Conflicts** to reject the incorrect assignment candidate, then accept/re-check the assignment that should remain active. Re-checking only marks the assignment CST-ready when no active overlaps remain and the CST-required data passes validation.

Exact duplicate CIDRs are still rejected by the database unique key and reported as `FAILED_DUPLICATE_CONFLICT`; keep one canonical row or load exact duplicates into a separate staging review outside the active assignment table.
