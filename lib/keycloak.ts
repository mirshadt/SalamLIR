const verifierKey = "ipam-keycloak-code-verifier";
const stateKey = "ipam-keycloak-state";

export type KeycloakSession = {
  accessToken: string;
  refreshToken?: string;
  username: string;
};

type KeycloakConfig = {
  url: string;
  realm: string;
  clientId: string;
  redirectUri: string;
};

export function keycloakConfig(): KeycloakConfig | null {
  const url = process.env.NEXT_PUBLIC_KEYCLOAK_URL;
  const realm = process.env.NEXT_PUBLIC_KEYCLOAK_REALM;
  const clientId = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID;
  if (!url || !realm || !clientId || typeof window === "undefined") {
    return null;
  }
  return {
    url: url.replace(/\/$/, ""),
    realm,
    clientId,
    redirectUri: process.env.NEXT_PUBLIC_KEYCLOAK_REDIRECT_URI ?? window.location.origin
  };
}

export function isKeycloakConfigured() {
  return Boolean(keycloakConfig());
}

export async function beginKeycloakLogin() {
  const config = keycloakConfig();
  if (!config) {
    throw new Error("Keycloak environment variables are not configured");
  }

  const verifier = randomString(64);
  const state = randomString(32);
  window.sessionStorage.setItem(verifierKey, verifier);
  window.sessionStorage.setItem(stateKey, state);

  const challenge = await pkceChallenge(verifier);
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    scope: "openid profile email",
    redirect_uri: config.redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state
  });

  window.location.assign(`${issuer(config)}/protocol/openid-connect/auth?${params.toString()}`);
}

export async function completeKeycloakLogin(code: string, state: string): Promise<KeycloakSession> {
  const config = keycloakConfig();
  const verifier = window.sessionStorage.getItem(verifierKey);
  const expectedState = window.sessionStorage.getItem(stateKey);
  if (!config || !verifier || !expectedState || state !== expectedState) {
    throw new Error("Invalid Keycloak login callback");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    code,
    code_verifier: verifier
  });

  const response = await fetch(`${issuer(config)}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!response.ok) {
    throw new Error(`Keycloak token exchange failed with HTTP ${response.status}`);
  }

  const token = await response.json();
  window.sessionStorage.removeItem(verifierKey);
  window.sessionStorage.removeItem(stateKey);
  const claims = decodeJwt(token.access_token);
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    username: claims.preferred_username ?? claims.email ?? claims.sub ?? "keycloak-user"
  };
}

export function keycloakLogoutUrl() {
  const config = keycloakConfig();
  if (!config) {
    return "";
  }
  const params = new URLSearchParams({
    client_id: config.clientId,
    post_logout_redirect_uri: config.redirectUri
  });
  return `${issuer(config)}/protocol/openid-connect/logout?${params.toString()}`;
}

function issuer(config: KeycloakConfig) {
  return `${config.url}/realms/${config.realm}`;
}

function randomString(length: number) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join("");
}

async function pkceChallenge(verifier: string) {
  const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeJwt(token: string): Record<string, string> {
  const [, payload] = token.split(".");
  if (!payload) {
    return {};
  }
  const json = window.atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(decodeURIComponent(escape(json)));
}
