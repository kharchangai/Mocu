import { describe, expect, it, vi } from "vitest";

import { TypedFieldsApi } from "../../../install-resources/extension-system/sdk-node/src/extract-typed-fields";
import type { JsonRpcProtocolClient } from "../../../install-resources/extension-system/sdk-node/src/protocol-client";

const fields = {
  invoice_number: { type: "text" as const },
  total: { type: "number" as const, unit: "USD", decimals: 2 },
};

describe("extension typed-field extraction API", () => {
  it("forwards the Extractions API input to the dedicated Mocu host method", async () => {
    const result = {
      answers: {
        invoice_number: { value: "INV-2291", confidence: 0.99, null_probability: 0.01 },
        total: { value: 1080, confidence: 0.96, null_probability: 0.02 },
      },
    };
    const request = vi.fn().mockResolvedValue(result);
    const api = new TypedFieldsApi({ request } as unknown as JsonRpcProtocolClient);

    await expect(api.typedFields({
      state: "Invoice INV-2291 total $1080",
      fields,
      reference_date: "2026-10-30",
    })).resolves.toEqual(result);

    expect(request).toHaveBeenCalledWith("mocu.extract.typed_fields", {
      state: "Invoice INV-2291 total $1080",
      fields,
      reference_date: "2026-10-30",
    });
  });

  it("rejects missing state or field definitions before calling the host", async () => {
    const request = vi.fn();
    const api = new TypedFieldsApi({ request } as unknown as JsonRpcProtocolClient);

    await expect(api.typedFields({ state: "", fields })).rejects.toThrow("non-empty state");
    await expect(api.typedFields({ state: "invoice", fields: {} })).rejects.toThrow("at least one field");
    expect(request).not.toHaveBeenCalled();
  });
});
