/* Program data and Roombook highlighted keyword taxonomy for GROUNDWORK (Kotagiri) */
(function () {
  const CATEGORIES = {
    A: { id: 'A', name: 'Living (the residents)', short: 'Living', color: '#b8945c', fill: 'rgba(184, 148, 92, 0.30)', fillStrong: 'rgba(184, 148, 92, 0.56)', stroke: '#8c6932' },
    B: { id: 'B', name: 'Arrival & gathering (the public heart)', short: 'Public', color: '#b56b58', fill: 'rgba(181, 107, 88, 0.30)', fillStrong: 'rgba(181, 107, 88, 0.56)', stroke: '#8f4736' },
    C: { id: 'C', name: 'Knowledge (the quiet core)', short: 'Knowledge', color: '#627788', fill: 'rgba(98, 119, 136, 0.30)', fillStrong: 'rgba(98, 119, 136, 0.56)', stroke: '#415566' },
    D: { id: 'D', name: 'Land, animals & service (the working edge)', short: 'Land & Service', color: '#6c8669', fill: 'rgba(108, 134, 105, 0.30)', fillStrong: 'rgba(108, 134, 105, 0.56)', stroke: '#496346' }
  };

  /* Keywords extracted from highlights in MM26WS_Groundwork_Roombook.pdf */
  const KEYWORDS = [
    // Climate & Microclimate
    { id: 'daylit', label: 'daylit', group: 'Climate', enabled: true },
    { id: 'indirect-daylight', label: 'indirect daylight', group: 'Climate', enabled: true },
    { id: 'blackout-capable', label: 'blackout-capable', group: 'Climate', enabled: true },
    { id: 'cross-ventilated', label: 'cross-ventilated', group: 'Climate', enabled: true },
    { id: 'rain-sheltered', label: 'rain-sheltered', group: 'Climate', enabled: true },
    { id: 'deep-roof', label: 'deep roof', group: 'Climate', enabled: true },
    { id: 'cool-dry', label: 'cool & dry', group: 'Climate', enabled: true },
    { id: 'damp-sensitive', label: 'damp/mould control', group: 'Climate', enabled: true },
    { id: 'dark-stable', label: 'dark & stable', group: 'Climate', enabled: true },
    { id: 'thermal-mass', label: 'thermal mass', group: 'Climate', enabled: true },
    { id: 'drying-monsoon', label: 'monsoon drying', group: 'Climate', enabled: true },
    { id: 'semi-open', label: 'semi-open', group: 'Climate', enabled: true },

    // Social & Acoustic
    { id: 'quiet', label: 'quiet', group: 'Social & Acoustic', enabled: true },
    { id: 'private', label: 'private', group: 'Social & Acoustic', enabled: true },
    { id: 'social-heart', label: 'social heart', group: 'Social & Acoustic', enabled: true },
    { id: 'public-gathering', label: 'public gathering', group: 'Social & Acoustic', enabled: true },
    { id: 'communal-dining', label: 'communal dining', group: 'Social & Acoustic', enabled: true },
    { id: 'flexible', label: 'flexible', group: 'Social & Acoustic', enabled: true },
    { id: 'live-work', label: 'live-work', group: 'Social & Acoustic', enabled: true },
    { id: 'step-free', label: 'step-free', group: 'Social & Acoustic', enabled: true },
    { id: 'accessible', label: 'accessible WC', group: 'Social & Acoustic', enabled: true },

    // Ground, Slope & Water
    { id: 'slope-view', label: 'slope & view', group: 'Ground & Water', enabled: true },
    { id: 'earth-sheltered', label: 'earth-sheltered', group: 'Ground & Water', enabled: true },
    { id: 'vegetated-terraces', label: 'vegetated terraces', group: 'Ground & Water', enabled: true },
    { id: 'avoid-slope-cut', label: 'avoid bare slope cut', group: 'Ground & Water', enabled: true },
    { id: 'permeable', label: 'permeable surface', group: 'Ground & Water', enabled: true },
    { id: 'water-cycle', label: 'rain/greywater cycle', group: 'Ground & Water', enabled: true },
    { id: 'leachate-capture', label: 'leachate capture', group: 'Ground & Water', enabled: true },
    { id: 'roof-water-shedding', label: 'roof water-shedding', group: 'Ground & Water', enabled: true },
    { id: 'predator-secure', label: 'predator-secure', group: 'Ground & Water', enabled: true },

    // Functional & Adjacency
    { id: 'arrival-entry', label: 'oversees arrival/entry', group: 'Adjacency', enabled: true },
    { id: 'kitchen-link', label: 'linked to kitchen', group: 'Adjacency', enabled: true },
    { id: 'hall-link', label: 'adjacent to hall', group: 'Adjacency', enabled: true },
    { id: 'verandah-link', label: 'adjacent to verandah', group: 'Adjacency', enabled: true },
    { id: 'food-storage-link', label: 'direct to food storage', group: 'Adjacency', enabled: true },
    { id: 'delivery-route', label: 'delivery route', group: 'Adjacency', enabled: true },
    { id: 'library-link', label: 'by the library', group: 'Adjacency', enabled: true },
    { id: 'farmland-cycle', label: 'farmland / garden cycle', group: 'Adjacency', enabled: true },
    { id: 'wet-service', label: 'wet service', group: 'Adjacency', enabled: true },
    { id: 'cleaning-store', label: 'cleaning store', group: 'Adjacency', enabled: true },
    { id: 'visiting-staff', label: 'visiting Foundation staff', group: 'Adjacency', enabled: true },
    { id: 'minimal-wet-walk', label: 'minimise wet walk', group: 'Adjacency', enabled: true }
  ];

  const PROGRAM_TEMPLATES = [
    {
      ref: 'A1', name: 'Living studio (AiR)', short: 'Studio', qty: 5, area: 35, cat: 'A', aspect: 1.4,
      keywords: ['live-work', 'daylit', 'cross-ventilated', 'damp-sensitive', 'rain-sheltered', 'slope-view', 'quiet', 'private'],
      links: ['A2', 'A1'],
      separations: ['B2'],
      note: 'Live-work unit for one artist: sleep and work, private bathroom. Daylight, cross-ventilation against damp, sheltered outdoor threshold for rain. Clear relation to slope and view; quiet, separate from the hall.'
    },
    {
      ref: 'A2', name: "Shared residents' amenity", short: 'Amenity', qty: 1, area: 25, cat: 'A', aspect: 1.25,
      keywords: ['social-heart', 'drying-monsoon', 'cross-ventilated', 'private', 'rain-sheltered'],
      links: ['A1'],
      separations: [],
      note: 'Shared pantry/lounge and drying room (five artists through weeks of monsoon). The social heart of the residency.'
    },
    {
      ref: 'A3', name: 'Housekeeper / groundskeeper dwelling', short: 'Keeper Home', qty: 1, area: 44, cat: 'A', aspect: 1.4,
      keywords: ['arrival-entry', 'private', 'quiet', 'live-work', 'cross-ventilated'],
      links: ['B1', 'D10'],
      separations: ['B2', 'B4', 'B5'],
      note: 'Resident-staff home: bedroom (16), kitchen/living (16), bathroom, store. Oversees arrival; own entrance; private from public areas.'
    },
    {
      ref: 'B1', name: 'Office / reception', short: 'Reception', qty: 1, area: 15, cat: 'B', aspect: 1.35,
      keywords: ['arrival-entry', 'visiting-staff', 'public-gathering', 'daylit'],
      links: ['A3', 'B2', 'D10'],
      separations: [],
      note: "Runs the residency: bookings, admin, handover; a base for visiting Foundation staff. Counterpart to the groundskeeper's watch over the entry."
    },
    {
      ref: 'B2', name: 'Multipurpose hall', short: 'Hall', qty: 1, area: 186, cat: 'B', aspect: 1.45,
      keywords: ['public-gathering', 'flexible', 'daylit', 'blackout-capable', 'step-free', 'roof-water-shedding', 'kitchen-link', 'slope-view', 'hall-link'],
      links: ['B3', 'B4', 'B5', 'B1'],
      separations: ['A1', 'A3', 'C1'],
      note: 'Largest room: lectures and workshops, exhibitions, dance, film, large banquets. Structural set-piece: show spanning and roof water-shedding in section. Flexible, daylit but black-out-capable, step-free, linked to kitchen and outdoors.'
    },
    {
      ref: 'B3', name: 'Community kitchen', short: 'Kitchen', qty: 1, area: 56, cat: 'B', aspect: 1.4,
      keywords: ['cross-ventilated', 'food-storage-link', 'delivery-route', 'hall-link', 'verandah-link', 'farmland-cycle', 'wet-service', 'public-gathering'],
      links: ['D9', 'B2', 'B4', 'D10', 'D1', 'D6'],
      separations: [],
      note: 'Farm-to-table kitchen and pop-up venue. Well-ventilated, direct to food storage and a delivery route, adjacent to hall and verandah.'
    },
    {
      ref: 'B4', name: 'Dining verandah', short: 'Verandah', qty: 1, area: 52, cat: 'B', aspect: 1.6,
      keywords: ['semi-open', 'communal-dining', 'deep-roof', 'slope-view', 'rain-sheltered', 'kitchen-link', 'farmland-cycle', 'cross-ventilated', 'public-gathering'],
      links: ['B3', 'B2', 'D1', 'B5'],
      separations: ['A3'],
      note: 'Semi-open communal dining for residents and those working the land. A climatic room: deep roof, open to the view, sheltered from driving rain; linked to kitchen and farmland.'
    },
    {
      ref: 'B5', name: 'Shared sanitary', short: 'Sanitary', qty: 1, area: 36, cat: 'B', aspect: 1.5,
      keywords: ['accessible', 'cleaning-store', 'hall-link', 'minimal-wet-walk', 'wet-service', 'cross-ventilated'],
      links: ['B2', 'B6', 'B3', 'B4', 'D7'],
      separations: ['A3'],
      note: "Public WCs for hall/kitchen/verandah; one accessible WC; cleaner's cupboard. Placed to minimise a wet walk from the hall."
    },
    {
      ref: 'B6', name: 'Housekeeping', short: 'Housekeep.', qty: 1, area: 14, cat: 'B', aspect: 1.3,
      keywords: ['wet-service', 'cleaning-store', 'minimal-wet-walk'],
      links: ['B5', 'D8', 'A1', 'B3'],
      separations: [],
      note: "Small room with a janitor's sink and cleaning store."
    },
    {
      ref: 'C1', name: 'Nature library', short: 'Library', qty: 1, area: 50, cat: 'C', aspect: 1.4,
      keywords: ['quiet', 'indirect-daylight', 'damp-sensitive', 'cross-ventilated', 'library-link'],
      links: ['C2', 'A1'],
      separations: ['B2'],
      note: 'Reading room on ecology and agriculture with a few desks. Calm, indirectly daylit (protect books from damp and glare), well-ventilated against mould.'
    },
    {
      ref: 'C2', name: 'Seedbank', short: 'Seedbank', qty: 1, area: 24, cat: 'C', aspect: 1.35,
      keywords: ['quiet', 'library-link', 'cool-dry', 'dark-stable', 'thermal-mass', 'earth-sheltered', 'damp-sensitive'],
      links: ['C1', 'D1', 'D9'],
      separations: [],
      note: 'Indigenous seed archive (millet landraces, native beans and greens), by the library. Cool, dry, dark, stable; thermal mass / partly earth-sheltered. Resolve moisture control and earth-sheltered junction in section.'
    },
    {
      ref: 'D1', name: 'Vegetable terraces', short: 'Terraces', qty: 1, area: 200, cat: 'D', aspect: 2.0,
      keywords: ['vegetated-terraces', 'avoid-slope-cut', 'farmland-cycle', 'water-cycle', 'slope-view', 'daylit'],
      links: ['D7', 'D6', 'D5', 'D8', 'B4', 'B3', 'C2', 'D9'],
      separations: [],
      note: 'Worked on the slope with vegetated terrace risers, not bare cut. Millets, native landrace beans and greens, and medicinal herbs.'
    },
    {
      ref: 'D5', name: 'Poultry run', short: 'Poultry', qty: 2, area: 10, cat: 'D', aspect: 1.6,
      keywords: ['rain-sheltered', 'predator-secure', 'farmland-cycle'],
      links: ['D1', 'D6', 'D8'],
      separations: [],
      note: 'Hardy local breed; fully roofed, buried-wire-skirted, predator-secure; part of the garden cycle.'
    },
    {
      ref: 'D6', name: 'Compost + manure yard', short: 'Compost', qty: 1, area: 12, cat: 'D', aspect: 1.3,
      keywords: ['rain-sheltered', 'leachate-capture', 'farmland-cycle', 'kitchen-link', 'wet-service'],
      links: ['D1', 'D5', 'B3', 'D7'],
      separations: [],
      note: 'Covered, lined, with leachate capture; dung and food waste to compost/vermicompost (optional small biogas digester for the kitchen).'
    },
    {
      ref: 'D7', name: 'Water & services', short: 'Water/Sys', qty: 1, area: 30, cat: 'D', aspect: 1.5,
      keywords: ['water-cycle', 'roof-water-shedding', 'farmland-cycle', 'wet-service'],
      links: ['D1', 'B2', 'B5', 'D6'],
      separations: [],
      note: 'Rainwater cistern(s) and a greywater reed-bed treating water before it reaches the edible terraces.'
    },
    {
      ref: 'D8', name: 'Service / tool store', short: 'Tool Store', qty: 1, area: 20, cat: 'D', aspect: 1.4,
      keywords: ['farmland-cycle', 'wet-service', 'cleaning-store', 'rain-sheltered'],
      links: ['D1', 'D5', 'D6', 'B6'],
      separations: [],
      note: 'Garden and farm tools, equipment, housekeeping wet area. Near farmland and shelter.'
    },
    {
      ref: 'D9', name: 'Food storage', short: 'Food Store', qty: 1, area: 24, cat: 'D', aspect: 1.4,
      keywords: ['cool-dry', 'dark-stable', 'damp-sensitive', 'kitchen-link', 'farmland-cycle', 'drying-monsoon'],
      links: ['B3', 'D1', 'C2'],
      separations: [],
      note: 'Cool dry store off the kitchen, with preservation and lean-season storage (millet, drying, fermentation).'
    },
    {
      ref: 'D10', name: 'Parking', short: 'Parking', qty: 1, area: 60, cat: 'D', aspect: 2.2, freeResize: true, excludeFromNetTotal: true,
      keywords: ['delivery-route', 'arrival-entry', 'avoid-slope-cut', 'permeable'],
      links: ['B3', 'B1', 'A3'],
      separations: [],
      note: 'As required. A few cars, two-wheelers, one delivery bay at the upper road edge to avoid cutting the slope; permeable surface.'
    }
  ];

  function createCatalogSpaces() {
    const spaces = [];
    for (const tpl of PROGRAM_TEMPLATES) {
      for (let q = 1; q <= tpl.qty; q++) {
        const id = tpl.qty > 1 ? `${tpl.ref}-${q}` : tpl.ref;
        const label = tpl.qty > 1 ? `${tpl.name} #${q}` : tpl.name;
        const shortLabel = tpl.qty > 1 ? `${tpl.short} ${q}` : tpl.short;
        spaces.push({
          id,
          ref: tpl.ref,
          instanceIndex: q,
          qty: tpl.qty,
          name: label,
          short: shortLabel,
          cat: tpl.cat,
          area: tpl.area,
          aspect: tpl.aspect || 1.4,
          freeResize: !!tpl.freeResize,
          excludeFromNetTotal: !!tpl.excludeFromNetTotal,
          keywords: tpl.keywords.slice(),
          links: tpl.links.slice(),
          separations: tpl.separations.slice(),
          note: tpl.note
        });
      }
    }
    return spaces;
  }

  function computeRelevance(spaceA, spaceB, activeKeywordIds) {
    if (!spaceA || !spaceB || spaceA.id === spaceB.id) {
      return { score: 0, sharedKeywords: [], hasDirectLink: false, hasConflict: false };
    }
    const setA = new Set((spaceA.keywords || []).filter(k => activeKeywordIds.has(k)));
    const setB = new Set((spaceB.keywords || []).filter(k => activeKeywordIds.has(k)));
    const shared = [];
    for (const k of setA) {
      if (setB.has(k)) shared.push(k);
    }
    const unionCount = new Set([...setA, ...setB]).size;
    const jaccard = unionCount > 0 ? shared.length / unionCount : 0;

    const hasDirectLink =
      (spaceA.links && spaceA.links.includes(spaceB.ref)) ||
      (spaceB.links && spaceB.links.includes(spaceA.ref));

    const hasConflict =
      (spaceA.separations && spaceA.separations.includes(spaceB.ref)) ||
      (spaceB.separations && spaceB.separations.includes(spaceA.ref));

    // Blend active keyword similarity with explicit roombook relationship
    let score = jaccard * 0.72 + Math.min(1, shared.length / 4) * 0.18 + (hasDirectLink ? 0.25 : 0);
    if (spaceA.cat === spaceB.cat && shared.length > 0) score += 0.05;
    if (hasConflict) score = Math.min(score, 0.25);
    score = Math.max(0, Math.min(1, score));

    return { score, sharedKeywords: shared, hasDirectLink, hasConflict };
  }

  window.GROUNDWORK_PROGRAM = {
    DEFAULT_FLOOR_HEIGHT: 3.0,
    NET_TOTAL_TARGET: 983,
    GROSS_MULTIPLIER: 1.32,
    CATEGORIES,
    KEYWORDS,
    PROGRAM_TEMPLATES,
    createCatalogSpaces,
    computeRelevance
  };
})();
