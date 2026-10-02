// Small dependency-free fuzzy matcher for resolving free-text party names
// ("Peter", "peter samuel") against the names actually seen in this
// company's transactions/settlements/pendingOrders. Good enough for an
// SMB-sized customer list — no need for a real search index.

export function normalizeName(s) {
  return String(s || "").toLowerCase().trim().replace(/\s+/g, " ");
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

// Returns candidates sorted best-first: [{ name, score }], score in (0, 1].
// 1 = exact match, 0.9 = prefix match, 0.75 = substring match,
// below that = typo-tolerant Levenshtein similarity.
export function fuzzyMatchNames(candidateNames, query, { limit = 5, minScore = 0.35 } = {}) {
  const q = normalizeName(query);
  if (!q) return [];

  const uniqueNames = [...new Set(candidateNames.filter(Boolean))];

  const scored = uniqueNames.map((name) => {
    const n = normalizeName(name);
    let score;
    if (n === q) score = 1;
    else if (n.startsWith(q) || q.startsWith(n)) score = 0.9;
    else if (n.includes(q) || q.includes(n)) score = 0.75;
    else {
      const dist = levenshtein(n, q);
      const maxLen = Math.max(n.length, q.length) || 1;
      score = Math.max(0, 1 - dist / maxLen) * 0.7; // capped below substring matches
    }
    return { name, score };
  });

  return scored
    .filter((s) => s.score > minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
