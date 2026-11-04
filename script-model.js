(function (root) {
  'use strict';
  const sections = [
    ['title', 'TITRE', 160], ['objective', 'OBJECTIF', 1000],
    ['target', 'PUBLIC CIBLE', 1000], ['hook', 'ACCROCHE', 500],
    ['publication', 'TEXTE PUBLICATION', 5000], ['hashtags', 'HASHTAGS', 2200],
    ...[1, 2, 3, 4].map(n => ['scene' + n, 'SCÈNE ' + n, 3000]),
    ['narration', 'NARRATION', 800], ['cta', "APPEL À L’ACTION", 500],
    ['visualPrompt', 'PROMPT VISUEL', 3000], ['style', 'STYLE', 120]
  ];
  const heading = value => value.toLocaleUpperCase('fr').replace(/SCENE/g, 'SCÈNE').replace(/'/g, '’');
  const known = new Map(sections.map(([key, name]) => [heading(name), key]));
  function parse(text) {
    const fields = Object.fromEntries(sections.map(([key]) => [key, []]));
    let current = null;
    for (const original of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
      const line = original.replace(/^\s*#{1,6}\s*/, '').replace(/\*\*/g, '').trim();
      const colon = line.indexOf(':');
      const label = heading(colon < 0 ? line : line.slice(0, colon).trim());
      if (known.has(label)) {
        current = known.get(label);
        if (colon >= 0) fields[current].push(line.slice(colon + 1).trim());
      } else if (current) fields[current].push(original);
    }
    const result = {};
    for (const [key] of sections) if (!key.startsWith('scene')) result[key] = fields[key].join('\n').trim();
    result.scenes = [1, 2, 3, 4].map(n => fields['scene' + n].join('\n').trim());
    return result;
  }
  function normalize(value) {
    if (!value || !Array.isArray(value.scenes) || value.scenes.length !== 4) throw Error('Préparez exactement quatre scènes.');
    const result = {};
    for (const [key, name, max] of sections) {
      const raw = key.startsWith('scene') ? value.scenes[Number(key.slice(5)) - 1] : value[key];
      if (typeof raw !== 'string') throw Error('Complétez le champ « ' + name + ' ».');
      const text = raw.replace(/\r\n?/g, '\n').trim();
      if (text.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw Error('Le champ « ' + name + ' » est trop long ou invalide.');
      for (const line of text.split('\n')) {
        const clean = line.replace(/^\s*#{1,6}\s*/, '').replace(/\*\*/g, '').trim();
        const colon = clean.indexOf(':');
        if (known.has(heading((colon < 0 ? clean : clean.slice(0, colon)).trim()))) throw Error('Évitez les titres de rubrique dans le contenu du champ « ' + name + ' ».');
      }
      if ((key === 'title' || key.startsWith('scene')) && !text) throw Error('Le titre et les quatre scènes sont nécessaires.');
      if (!key.startsWith('scene')) result[key] = text;
    }
    result.scenes = value.scenes.map(scene => scene.replace(/\r\n?/g, '\n').trim());
    return result;
  }
  function serialize(value) {
    const script = normalize(value);
    return sections.map(([key, name]) => name + '\n' + (key.startsWith('scene') ? script.scenes[Number(key.slice(5)) - 1] : script[key])).join('\n\n');
  }
  function order(value) {
    if (!Array.isArray(value) || value.length !== 4 || new Set(value).size !== 4 || value.some(n => !Number.isInteger(n) || n < 0 || n > 3)) throw Error('L’ordre des scènes est invalide.');
    return value.slice();
  }
  root.olyvexScriptModel = Object.freeze({parse, normalize, serialize, order});
})(globalThis);
