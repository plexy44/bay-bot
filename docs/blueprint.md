# **App Name**: BayBot

## Core Features:

- Dynamic Homepage: Intelligently curated homepage with random popular search terms when no user query is provided.
- Deal Card Display: Display deals and auction items in a consistent, card-based format with image, title, price, and discount information, show highest discount first.
- Client-Side Pagination: Client-side pagination with a 'Load More' button for seamless browsing.
- View Selection & Search: Tabs in header to switch between 'Deals' and 'Auctions' views with an integrated search form.
- Smart Deal Ranking: Automatically re-order deals by discount percentage, relevance to the search query, price, and seller reputation. The original, unranked list will be gracefully returned as a tool in case of failure.
- AI Item Analysis: On-demand AI analysis of individual deals, displayed in a modal with risk and rarity scores, UI should be animated pill shaped bars filling up.
- EBay API Integration: Connect to the eBay Production API using OAuth2, transform responses into standardized data types, and cache tokens to improve efficiency.

## Style Guidelines:

- Primary color: Light gray (#f8fafc) from Tailwind's 'foreground' color variable for main text and UI elements.
- Background color: Very dark blue (#020817) from Tailwind's 'background' color variable to set a modern, high-contrast tone.
- Accent color: Dark gray-blue (#1e293b) from Tailwind's 'secondary' color variable for muted elements and subtle highlights.
- Headline font: 'Space Grotesk' sans-serif for titles and larger text, paired with 'Inter' sans-serif for body.
- Lucide React icons for a consistent, clean interface.
- Use 'card' (#0f172a) from tailwind.config.ts to give containers a distinct appearance for better readability. Follow spacing conventions and visual hierarchy.
- Subtle transitions and loading states to improve user experience.