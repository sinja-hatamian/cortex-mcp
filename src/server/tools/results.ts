export function toolResult(structuredContent: Record<string, unknown>) {
  return {
    structuredContent,
    content: [
      { type: 'text' as const, text: JSON.stringify(structuredContent) },
    ],
  };
}

export function toolError(
  code: 'INVALID_REFERENCE' | 'STORAGE_ERROR',
  message: string,
) {
  return { ...toolResult({ code, message }), isError: true };
}
