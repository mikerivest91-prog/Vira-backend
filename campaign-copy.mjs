export function copyCampaignData(source = {}) {
  const copy = {};
  for (const key of ['brief','scenario','generatedImages','marketingType','brand','publicationDraft']) {
    if (Object.hasOwn(source,key)) copy[key] = structuredClone(source[key]);
  }
  return copy;
}

