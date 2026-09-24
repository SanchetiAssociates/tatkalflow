/**
 * Delivery of one-time codes. The auth service generates and hashes the code;
 * providers only deliver it. Providers must never log the code or the full
 * message body.
 */
export interface OtpDeliveryRequest {
  /** E.164, e.g. +919820012345 */
  mobile: string;
  code: string;
  ttlSeconds: number;
}

export interface OtpDeliveryResult {
  /** Provider message reference, safe to store. Never the code. */
  providerRef: string | null;
}

export interface OTPProvider {
  readonly name: string;
  /**
   * When set, the auth service uses this code instead of a random one.
   * Only the development mock provider may return a value.
   */
  fixedCode?(): string | undefined;
  send(request: OtpDeliveryRequest): Promise<OtpDeliveryResult>;
}

export class OtpDeliveryError extends Error {
  constructor(readonly provider: string, message: string) {
    super(message);
    this.name = "OtpDeliveryError";
  }
}

/**
 * Development/test provider. Nothing is sent and nothing is logged.
 *
 * - With a fixed code (MOCK_OTP_FIXED_CODE), every OTP is that value, so a
 *   developer can sign in without the code ever appearing in logs.
 * - Tests read delivered codes from the in-memory `outbox`.
 */
export class MockOTPProvider implements OTPProvider {
  readonly name = "mock";
  readonly outbox: OtpDeliveryRequest[] = [];
  failNext = false;

  constructor(private readonly fixed?: string) {}

  fixedCode(): string | undefined {
    return this.fixed;
  }

  async send(request: OtpDeliveryRequest): Promise<OtpDeliveryResult> {
    if (this.failNext) {
      this.failNext = false;
      throw new OtpDeliveryError(this.name, "Simulated delivery failure");
    }
    this.outbox.push(request);
    return { providerRef: `mock-${this.outbox.length}` };
  }

  lastCodeFor(mobile: string): string | undefined {
    return this.outbox.findLast((m) => m.mobile === mobile)?.code;
  }
}

type ProviderFactory = () => OTPProvider;
const registry = new Map<string, ProviderFactory>();

/**
 * Production providers (MSG91, Twilio, Gupshup, …) register themselves here
 * with their own env configuration. The auth flow only sees `OTPProvider`.
 */
export function registerOtpProvider(name: string, factory: ProviderFactory): void {
  registry.set(name, factory);
}

export function createOtpProvider(name: string, options: { mockFixedCode?: string | undefined }): OTPProvider {
  if (name === "mock") return new MockOTPProvider(options.mockFixedCode);
  const factory = registry.get(name);
  if (!factory) {
    throw new Error(`OTP provider "${name}" is not registered. Available: mock${registry.size ? ", " + [...registry.keys()].join(", ") : ""}`);
  }
  return factory();
}
