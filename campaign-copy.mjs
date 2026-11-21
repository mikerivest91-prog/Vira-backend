export function copyCampaignData(source = {}) {
  const copy = {};
  for (const key of ['brief','scenario','audience','goal','tone','platform','generatedImages','marketingType','brand','publicationDraft']) {
    if (Object.hasOwn(source,key)) copy[key] = structuredClone(source[key]);
  }
  return copy;
}

