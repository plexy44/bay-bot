# Firebase Studio

This is a NextJS starter in Firebase Studio.

## Getting Started

To get started, you first need to configure your environment variables.

### Setup

1.  **Create an environment file**: Create a new file in the root of your project named `.env`.

2.  **Add your API Keys**: Open the `.env` file and add your credentials for the eBay and Google AI APIs. It should look like this:

    ```
    EBAY_APP_ID="YOUR_EBAY_APP_ID"
    EBAY_CERT_ID="YOUR_EBAY_CERT_ID"
    GOOGLE_API_KEY="YOUR_GOOGLE_AI_API_KEY"
    ```
    Replace the placeholder values with your actual credentials.
    *   `EBAY_APP_ID`: Your application ID from the eBay Developer Program.
    *   `EBAY_CERT_ID`: Your certificate ID from the eBay Developer Program.
    *   `GOOGLE_API_KEY`: Your API key from Google AI Studio or Google Cloud.

3.  **Run the application**: Once your keys are in the `.env` file, you can run the development server:
    ```bash
    npm run dev
    ```

Now you can start making changes to the app, beginning with `src/app/page.tsx`.
