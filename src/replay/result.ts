// Never collapse this into a single success:boolean — "no such member" is a
// legitimate answer, not a crash, and a hard failure needs debug detail a
// boolean can't carry. See PDF glossary: "Business outcome vs. failure."
export type ReplayResult<TOutputs> =
  | { kind: "success"; outputs: TOutputs }
  | { kind: "business_outcome"; signature: string; description: string }
  | {
      kind: "hard_failure";
      stepId: string;
      expected: string;
      observed: string;
      message: string;
    };

export function isSuccess<T>(
  result: ReplayResult<T>
): result is Extract<ReplayResult<T>, { kind: "success" }> {
  return result.kind === "success";
}
