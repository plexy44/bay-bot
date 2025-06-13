
export const curatedHomepageSearchTerms: string[] = [
  'Tablets',
  'laptops',
  'Apple',
  'Samsung',
  'Samsung phone',
  'macbook',
  'iphone',
  'ipad',
  'apple watch',
  'airpods',
  'Games',
  'playstation',
  'dj controller pioneer',
  'PS5',
  'PS5 Console',
  'Ps4',
  'PS4 Console',
  'xbox',
  'Logitech',
  'Guitars',
  'Ghost of Tsushima',
  'Monitor',
  'TV',
  'nintendo switch',
  'The Last of Us',
  'Steam Deck',
  'yamaha keyboard',
  'acoustic guitar'
];

export const GLOBAL_CURATED_DEALS_REQUEST_MARKER = "__GLOBAL_DEALS__";
export const GLOBAL_CURATED_AUCTIONS_REQUEST_MARKER = "__GLOBAL_AUCTIONS__";

export const STANDARD_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const GLOBAL_CURATED_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export const EXCLUSION_KEYWORDS: string[] = [
  'box only', 'empty box', 'original box',
  'cover only', 'case only', 'skin only', 'sleeve only',
  'manual only', 'guide only', 'booklet only',
  'charger only', 'cable only', 'adapter only', 'power supply only',
  'screen protector', 'tempered glass',
  'for parts', 'not working', 'faulty', 'spares or repair',
  'display only', 'touch screen only', 'lcd only', 'digitizer only',
  'housing only', 'back cover only', 'frame only',
  'motherboard only', 'logic board only',
  'battery only',
  'photo of', 'picture of',
  'toy model', 'replica', 'dummy',
  'pouch', 'dust bag',
  'stand only', 'mount only',
  'strap only', 'band only',
  'controller shell', 'faceplate',
  'protective film',
  'no console', 'console not included',
  'no device', 'device not included',
  'no game', 'game not included',
  'no item', 'item not included'
];

export const MIN_SELLER_REPUTATION_THRESHOLD = 80; // Minimum seller reputation (e.g., 80%)
export const MIN_DEAL_DISCOUNT_THRESHOLD = 5; // Minimum discount percentage for a deal to be considered (e.g., 5%)

