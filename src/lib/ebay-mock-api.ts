import type { BayBotItem } from '@/types';

const mockDeals: BayBotItem[] = [
  {
    id: 'deal1',
    type: 'deal',
    title: 'High-Performance Laptop Pro X1',
    description: 'Latest generation processor, 16GB RAM, 512GB SSD. Perfect for professionals and gamers. Lightweight design with a stunning 14-inch display. Extended battery life for all-day productivity.',
    imageUrl: 'https://placehold.co/600x400.png',
    price: 999.99,
    originalPrice: 1499.99,
    sellerReputation: 95,
  },
  {
    id: 'deal2',
    type: 'deal',
    title: 'Noise-Cancelling Headphones Z',
    description: 'Immersive sound experience with industry-leading noise cancellation. Up to 30 hours of playtime. Comfortable over-ear design for long listening sessions. Comes with a travel case.',
    imageUrl: 'https://placehold.co/600x400.png',
    price: 199.50,
    originalPrice: 299.00,
    sellerReputation: 92,
  },
  {
    id: 'deal3',
    type: 'deal',
    title: 'Smartwatch Series 5',
    description: 'Track your fitness, heart rate, and sleep. GPS, cellular connectivity. Water-resistant up to 50 meters. Large, always-on display with customizable watch faces.',
    imageUrl: 'https://placehold.co/600x400.png',
    price: 249.00,
    originalPrice: 399.00,
    sellerReputation: 88,
  },
  {
    id: 'deal4',
    type: 'deal',
    title: '4K Ultra HD Smart TV 55-inch',
    description: 'Stunning 4K resolution with HDR support. Built-in streaming apps. Voice remote included. Multiple HDMI ports for all your devices. Slim bezel design.',
    imageUrl: 'https://placehold.co/600x400.png',
    price: 450.00,
    originalPrice: 650.00,
    sellerReputation: 90,
  },
  {
    id: 'deal5',
    type: 'deal',
    title: 'Robotic Vacuum Cleaner Advanced',
    description: 'Smart navigation, app control, and scheduling. Self-charging. Strong suction power for pet hair and carpets. Quiet operation.',
    imageUrl: 'https://placehold.co/600x400.png',
    price: 220.00,
    originalPrice: 350.00,
    sellerReputation: 93,
  },
   {
    id: 'deal6',
    type: 'deal',
    title: 'Pro Gaming Mouse RGB',
    description: 'Ultra-lightweight design, 16000 DPI optical sensor, customizable RGB lighting, 8 programmable buttons. Perfect for competitive gaming.',
    imageUrl: 'https://placehold.co/600x400.png',
    price: 49.99,
    originalPrice: 79.99,
    sellerReputation: 96,
  },
  {
    id: 'deal7',
    type: 'deal',
    title: 'Wireless Earbuds TrueSound',
    description: 'Crystal clear audio, Bluetooth 5.2, 24-hour battery life with charging case, IPX7 waterproof. Secure fit for sports and daily use.',
    imageUrl: 'https://placehold.co/600x400.png',
    price: 79.00,
    originalPrice: 129.00,
    sellerReputation: 91,
  },
  {
    id: 'deal8',
    type: 'deal',
    title: 'Portable SSD 1TB FastDrive',
    description: 'Blazing fast read/write speeds, USB-C connectivity, compact and durable design. Ideal for transferring large files and backups.',
    imageUrl: 'https://placehold.co/600x400.png',
    price: 119.99,
    originalPrice: 179.99,
    sellerReputation: 94,
  },
];

const mockAuctions: BayBotItem[] = [
  {
    id: 'auction1',
    type: 'auction',
    title: 'Vintage Collector\'s Watch',
    description: 'Rare 1950s mechanical watch in excellent condition. Recently serviced. Stainless steel case with original leather strap. A true collector\'s piece with documented history.',
    imageUrl: 'https://placehold.co/600x400.png',
    price: 750.00, // current bid
    originalPrice: 1200.00, // estimated value
    sellerReputation: 98,
    endTime: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days from now
    bidCount: 15,
  },
  {
    id: 'auction2',
    type: 'auction',
    title: 'Limited Edition Art Print',
    description: 'Signed and numbered art print by a renowned contemporary artist. Only 100 copies worldwide. Comes with a certificate of authenticity. Measures 24x36 inches.',
    imageUrl: 'https://placehold.co/600x400.png',
    price: 320.00,
    originalPrice: 500.00,
    sellerReputation: 90,
    endTime: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days from now
    bidCount: 8,
  },
  {
    id: 'auction3',
    type: 'auction',
    title: 'Antique Silver Tea Set',
    description: 'Victorian-era silver tea set, complete with teapot, sugar bowl, and creamer. Hallmarked and in good antique condition. A beautiful display piece or for special occasions.',
    imageUrl: 'https://placehold.co/600x400.png',
    price: 450.00,
    originalPrice: 700.00,
    sellerReputation: 93,
    endTime: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day from now
    bidCount: 22,
  },
  {
    id: 'auction4',
    type: 'auction',
    title: 'Retro Gaming Console Bundle',
    description: 'Classic gaming console from the 90s, includes two controllers and five popular game cartridges. Tested and working. Relive your childhood memories!',
    imageUrl: 'https://placehold.co/600x400.png',
    price: 150.00,
    originalPrice: 250.00,
    sellerReputation: 85,
    endTime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days from now
    bidCount: 12,
  },
];

function calculateDiscountPercentage(item: BayBotItem): BayBotItem {
  if (item.originalPrice && item.price < item.originalPrice) {
    item.discountPercentage = Math.round(((item.originalPrice - item.price) / item.originalPrice) * 100);
  } else {
    item.discountPercentage = 0;
  }
  return item;
}

function formatTimeLeft(endTime?: string): string | undefined {
  if (!endTime) return undefined;
  const totalSeconds = Math.floor((new Date(endTime).getTime() - Date.now()) / 1000);
  if (totalSeconds <= 0) return "Ended";

  const days = Math.floor(totalSeconds / (3600 * 24));
  const hours = Math.floor((totalSeconds % (3600 * 24)) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}


mockDeals.forEach(calculateDiscountPercentage);
mockAuctions.forEach(calculateDiscountPercentage);
mockAuctions.forEach(auction => { auction.timeLeft = formatTimeLeft(auction.endTime) });


export const fetchItems = async (type: 'deal' | 'auction', query?: string): Promise<BayBotItem[]> => {
  await new Promise(resolve => setTimeout(resolve, 500)); // Simulate network delay

  let items = type === 'deal' ? [...mockDeals] : [...mockAuctions];

  if (query) {
    const lowerQuery = query.toLowerCase();
    items = items.filter(item =>
      item.title.toLowerCase().includes(lowerQuery) ||
      item.description.toLowerCase().includes(lowerQuery)
    );
  }
  
  // Add data-ai-hint dynamically based on title for placeholder images
  items = items.map(item => ({
    ...item,
    imageUrl: `${item.imageUrl}?${encodeURIComponent(item.title.split(' ').slice(0,2).join(' '))}`,
    // @ts-ignore
    'data-ai-hint': item.title.toLowerCase().split(' ').slice(0,2).join(' ')
  }));


  if (type === 'deal') {
    items.sort((a, b) => (b.discountPercentage ?? 0) - (a.discountPercentage ?? 0));
  } else { // For auctions, maybe sort by endTime or bids? For now, default sort.
    items.sort((a,b) => new Date(a.endTime!).getTime() - new Date(b.endTime!).getTime());
  }
  
  return items;
};

export const popularSearchTerms = ['laptop', 'headphones', 'smartwatch', 'camera', 'gaming console', 'kitchen appliance'];
