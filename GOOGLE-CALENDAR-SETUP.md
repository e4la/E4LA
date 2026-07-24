# Google Calendar booking setup

The website sends bookings to the Cloudflare Pages Function at `POST /api/book`. Google credentials stay in Cloudflare environment variables and are never sent to the browser.

## 1. Create or select a Google Cloud project

1. Open Google Cloud Console and create or select the project that will own the booking integration.
2. Go to **APIs & Services > Library**.
3. Enable **Google Calendar API**.

## 2. Configure OAuth consent

1. Go to **Google Auth Platform > Branding** (or **APIs & Services > OAuth consent screen** in the older console).
2. Configure the app name, support email, and developer contact email.
3. Choose the audience that fits the consultant account:
   - **Internal** if the calendar account is in the same Google Workspace organization and only organization users need to authorize it.
   - **External** for a personal Google account or authorization outside one Workspace organization.
4. Add the consultant Google account as a test user while the app is in Testing.
5. Add the scope `https://www.googleapis.com/auth/calendar.events` and, if Google requires it separately for availability reads, `https://www.googleapis.com/auth/calendar.readonly`.

For a production site, publish the OAuth app when ready. An External app left in Testing can issue refresh tokens that expire after seven days, which would stop bookings.

## 3. Create OAuth client credentials

1. Go to **Google Auth Platform > Clients** (or **APIs & Services > Credentials**).
2. Create an **OAuth client ID** with application type **Web application**.
3. Add this authorized redirect URI for the token-generation step:

   `https://developers.google.com/oauthplayground`

4. Save the client ID and client secret. Do not put either value in this repository or frontend JavaScript.

## 4. Generate the consultant refresh token

1. Open Google OAuth 2.0 Playground: `https://developers.google.com/oauthplayground/`.
2. Open the gear/settings panel, enable **Use your own OAuth credentials**, and enter the client ID and client secret from step 3.
3. In Step 1, enter these scopes:

   `https://www.googleapis.com/auth/calendar.events`

   `https://www.googleapis.com/auth/calendar.readonly`

4. Authorize APIs and sign in as the Google account that owns, or has write access to, the consultant calendar.
5. In Step 2, exchange the authorization code for tokens.
6. Copy the returned **refresh token** immediately and store it only in Cloudflare as described below.

If Google does not return a refresh token, revoke the app's access in the Google account and repeat the authorization with offline access/consent, or create a new OAuth grant.

## 5. Identify the consultant calendar

In Google Calendar, open **Settings > Settings for my calendars > Integrate calendar** and copy **Calendar ID**. For a primary calendar this is often the Google account email; secondary calendars usually have a longer ID.

The Google account used to create the refresh token must have permission to create events and invite attendees on this calendar. Confirm in Google Workspace Admin that external invitations are allowed if customers are outside the organization.

## 6. Add Cloudflare Pages environment variables

In Cloudflare Dashboard, open **Workers & Pages > your Pages project > Settings > Variables and Secrets**. Add these values to the **Production** environment (and Preview if you intend to test preview deployments):

| Variable | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | OAuth web client ID from Google Cloud |
| `GOOGLE_CLIENT_SECRET` | OAuth web client secret from Google Cloud |
| `GOOGLE_REFRESH_TOKEN` | Refresh token generated while signed in as the consultant calendar account |
| `GOOGLE_CALENDAR_ID` | Calendar ID that should receive consultation events |
| `CONSULTANT_TIME_ZONE` | IANA time zone used by the booking schedule, currently `America/Los_Angeles` |

Store the client secret and refresh token as encrypted secrets. Do not create or commit a `.env` file with production credentials.

After adding or changing variables, redeploy the Pages project so the Function receives them.

## 7. Deploy and verify

1. Deploy the project to Cloudflare Pages. The file `functions/api/book.js` becomes `POST /api/book` automatically.
2. Make a booking using a real test email address.
3. Confirm that the event appears on the consultant calendar, the customer is listed as an attendee, and Google sends the invitation.
4. Try the same time again and confirm the site reports that the time is unavailable.
5. On the confirmation screen, test both choices from **Add to Calendar**: open the existing Google event, or download the ICS file for Apple Calendar/Outlook.

The frontend must be tested on a Cloudflare Pages deployment (or with a local Pages Functions runtime). Opening `index.html` directly cannot execute `/api/book`.