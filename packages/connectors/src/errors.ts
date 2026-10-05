export class ConnectorError extends Error {
  constructor(public kind: "AuthError" | "RateLimited" | "Transient" | "InvalidRequest" | "PolicyRejected" | "NotFound" | "NeedsBrowser", message: string) {
    super(message);
  }
}
