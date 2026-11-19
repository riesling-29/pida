/** A provider-reported classification, never independent quota/billing verification. */
export type ProviderRejectionCode = "PROVIDER_SUBSCRIPTION_SHARING_LIMIT" | "PROVIDER_REJECTED";
const sharingLimit = "The ChatGPT user has reached their Subscription Sharing usage limit. Ask the user to try again after their usage limit resets or use an API key instead.";

/** Only fixed codes escape this boundary. Aborts and successful messages are not rejections. */
export function providerRejectionCode(message: { stopReason?: unknown; provider?: unknown; api?: unknown; errorMessage?: unknown } | undefined): ProviderRejectionCode | undefined {
  if (message?.stopReason !== "error") return undefined;
  if (message.provider === "openai" && message.api === "openai-responses"
    && typeof message.errorMessage === "string" && message.errorMessage.length <= 2048
    && message.errorMessage.trim() === sharingLimit) return "PROVIDER_SUBSCRIPTION_SHARING_LIMIT";
  return "PROVIDER_REJECTED";
}
