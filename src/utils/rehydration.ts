export const rehydrateResponse = (
  llmText: string,
  tokenDictionary: Record<string, string>
): string => {
  let rehydratedText = llmText;

  for (const [token, originalValue] of Object.entries(tokenDictionary)) {
    rehydratedText = rehydratedText.replaceAll(token, originalValue);
  }

  return rehydratedText;
};
