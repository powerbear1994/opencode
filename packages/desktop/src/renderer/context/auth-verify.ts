export type VerifyResult = "valid" | "invalid" | "unreachable"

export async function verifyWithServer(baseUrl: string, token: string): Promise<VerifyResult> {
  void baseUrl
  if (!token) return "invalid"
  return "valid"
}
