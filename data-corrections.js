// 经人工确认的文本修正。只按 deck + 稳定卡片 ID 修改文字，不改变 ID 或字段结构。
(function () {
  'use strict';
  if (typeof DATA === 'undefined' || !Array.isArray(DATA)) return;
  const fixes = {
    vwords: {
      v009: [['iterally ', 'literally ']],
      v036: [['less available or others', 'less available for others']],
      v043: [['ratioal', 'rational']],
      v166: [['privateownership', 'private ownership']],
      v167: [['onproducers', 'on producers']],
      v195: [['one or people', 'one or more people'], ['selling a floating exchange rate increases in value', 'selling when they expect it to fall']]
    },
    edaswords: {
      edas008: [['workers;.', 'workers.']],
      edas011: [['alternativethat', 'alternative that']],
      edas016: [['assets，', 'assets,']],
      edas018: [['planning progress', 'planning process']],
      edas039: [['wiling', 'willing']],
      edas044: [['risein', 'rise in']],
      edas055: [['economics transaction', 'economic transaction']]
    }
  };
  const deckFixes = fixes[window.DECK_SLUG];
  if (!deckFixes) return;
  DATA.forEach(function (card) {
    const replacements = deckFixes[card.id];
    if (!replacements) return;
    ['term', 'def', 'zh', 'note', 'cloze'].forEach(function (field) {
      if (typeof card[field] !== 'string') return;
      replacements.forEach(function (pair) { card[field] = card[field].split(pair[0]).join(pair[1]); });
    });
  });
})();
