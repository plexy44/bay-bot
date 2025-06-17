
export const curatedHomepageSearchTerms: string[] = [
  'Tablets',
  'Laptop',
  'Apple',
  'Samsung',
  'Macbook',
  'iPhone',
  'iPad',
  'Apple Watch',
  'AirPods',
  'PlayStation',
  'PS5',
  'PS5 Console',
  'PS4 Console',
  'Xbox',
  'Logitech',
  'Guitars',
  'Monitor',
  'TV',
  'Nintendo Switch',
  'Steam Deck',
  'Yamaha Keyboard',
  'Acoustic Guitar',
  'AirTag',
  'Supreme',
  'Palace Skateboards',
  'Ninja',
  'Superdry',
  'Adidas',
  'Reebok',
  'Puma',
  'Joules',
  'JD Sports',
  'Patagonia',
  'Michael Kors',
  'Fossil',
  'QLED',
  'OLED',
  'DJI',
  'Barbour',
  'Ted Baker',
  'Dr. Martens',
  'Seiko',
  'Nike',
  'Dell',
  'The North Face',
  'Air Jordan',
  'New Balance',
  'Vintage',
  'Gucci',
  'Prada',
  'Louis Vuitton',
  'Burberry',
  'Balenciaga',
  'Dior',
  'Chanel',
  'Yves Saint Laurent',
  'Fendi',
  'Bottega Veneta',
  'Versace',
  'Hermès',
  'Moncler',
  'Off-White',
  'Celine',
  'Valentino',
  'Alexander McQueen',
  'Givenchy',
  'Rolex',
  'Omega',
  'TAG Heuer',
  'Cartier',
  'Longines',
  'Tissot',
  'Montblanc',
  'Ray-Ban',
  'Canada Goose',
  'Christian Louboutin',
  'Tom Ford',
  'Armani',
  'Ralph Lauren Purple Label',
  'Mulberry',
  'Coach',
  'Tory Burch',
  'Vivienne Westwood',
  'Paul Smith',
  'Reiss',
  'AllSaints',
  "Women's Fashion",
  "Men's Fashion",
  'Trainers',
  'Sneakers',
  'Rare',
  'Limited Edition'
];

export const GLOBAL_CURATED_DEALS_REQUEST_MARKER = "__GLOBAL_DEALS__";
export const GLOBAL_CURATED_AUCTIONS_REQUEST_MARKER = "__GLOBAL_AUCTIONS__";

export const STANDARD_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const GLOBAL_CURATED_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
export const STALE_CACHE_THRESHOLD_FOR_SOFT_REFRESH_MS = 10 * 60 * 1000; // 10 minutes for soft refresh trigger

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

export const MIN_DESIRED_CURATED_ITEMS = 16;
export const MAX_CURATED_FETCH_ATTEMPTS = 3; // Max keywords for a single curated fetch batch during "Load More"
export const MIN_AI_QUALIFIED_ITEMS_THRESHOLD = 6;

export const CURATED_DEALS_CACHE_KEY = 'cachedCuratedDeals';
export const CURATED_AUCTIONS_CACHE_KEY = 'cachedCuratedAuctions';

// New constants for iterative initial curated deals fetch
export const MAX_TOTAL_KEYWORDS_TO_TRY_INITIAL_DEALS = 10; // Max unique keywords for initial curated deals fetch
export const KEYWORDS_PER_BATCH_INITIAL_DEALS = 3; // Keywords per batch in iterative initial deals fetch
export const TARGET_RAW_ITEMS_FACTOR_FOR_AI = 2; // Fetch e.g. 2x MIN_DESIRED_CURATED_ITEMS as raw items before AI ranking

// For proactive background caching
export const KEYWORDS_FOR_PROACTIVE_BACKGROUND_CACHE = 2;

// For caching searched content
export const SEARCHED_DEALS_CACHE_KEY_PREFIX = 'searchedDealsCache__';
export const SEARCHED_AUCTIONS_CACHE_KEY_PREFIX = 'searchedAuctionsCache__';

// For backend pagination / infinite scroll
export const API_FETCH_LIMIT = 200; // Number of items to fetch per API call for pagination

// For curated "Load More" persistence
export const MAX_CURATED_LOAD_MORE_TRIES = 3; // Number of times "Load More" can be clicked for curated, even if an attempt yields 0 new items.

