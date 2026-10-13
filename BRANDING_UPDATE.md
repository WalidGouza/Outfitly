# Outfitly branding update

The product name is Outfitly throughout the interface, browser title, API documentation, package metadata, setup documentation, and promotional composition. The header monogram is now o.

Replace the frontend/backend source in your existing deployment folder, preserve your current private backend .env and frontend API URL, and redeploy/rebuild both services. No database migration is required. For Docker, follow DEPLOYMENT.md for the new profile-based Docker setup.

Compatibility identifiers remain unchanged: browser storage keys preserve sessions, theme preferences, and saved sample outfits; database names/credentials and Docker project/volume names preserve existing data and model caches. The optional development database Compose file now explicitly pins its existing project name so extracting the renamed folder cannot select a new volume accidentally.

Previously supplied Render/Vercel hostnames remain actual deployment addresses. Changing their text would not rename the hosted services and could break requests or CORS. Update them only after configuring an actual replacement URL in your hosting provider. Keep your own current API URL (including outfitly.linkpc.net if already configured).

The API liveness service marker is now outfitly-api. Any external monitor that checks the marker rather than HTTP status must update its expected value.
