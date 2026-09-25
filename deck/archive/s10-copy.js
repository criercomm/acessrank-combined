// S10 · The ask — retirada del deck el 2026-09-23 (Carlos: la cifra y el uso de fondos van en hojas de cálculo aparte,
// no en el deck). Copy tal como estaba; la lámina está en archive/s10-ask.js y su CSS sigue en src/style.css (.s10-*).
// Para volver: pegar este bloque en src/copy.js, 'The ask' en chapters, y s10 en main.js (import, all y SHORT).
export const s10 = {
    title: ['From operated alpha', 'to general availability.'],
    ask: 'Raising $600K for the next 18 months.',
    usesLabel: 'Use of funds',
    // Carlos's plan of 2026-09-16 (8 lines, $600K) grouped into five buckets; the detail keeps every original line
    uses: [
      { label: 'Product and infrastructure', pct: 36, amount: '$216K', detail: 'Cloud infrastructure and build sandbox 16% · Mobile performance and field data 11% · Integrations and self-serve billing 9%' },
      { label: 'Team', pct: 22, amount: '$132K', detail: 'Founder and key hires' },
      { label: 'Go-to-market', pct: 18, amount: '$108K', detail: 'Marketing and conferences, plus in-kind agency support from CrierPR.com: content, positioning, press' },
      { label: 'Company and legal', pct: 17, amount: '$102K', detail: 'Legal and entity formation 10% · Insurance, tools and office 7%' },
      { label: 'Working capital and contingency', pct: 7, amount: '$42K' },
    ],
    milestonesLabel: 'Milestones',
    milestones: [
      { when: 'Q4 2026', what: 'Infrastructure for general availability: sandbox, managed cloud, secrets' },
      { when: 'Q1 2027', what: 'Real mobile performance and field data in reports' },
      { when: 'Q2 2027', what: 'Self-serve billing and agency tier' },
      { when: '2027', what: 'More standards: AI search, security, compliance' },
    ],
    close: ["FIXING THE WEB'S", 'BIGGEST BLIND SPOT.'],
    notes: 'State the number and the instrument: $600K for the next 18 months. Then where it goes: more than a third into product and infrastructure, then team, go-to-market and company costs. Marketing reaches further than its line, because CrierPR adds content, positioning and press in kind. Then stop talking. The milestone quarters are illustrative until confirmed.',
}
