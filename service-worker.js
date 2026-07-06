# Nova Recipe Builder — Azure Static Web Apps Deployment Package

This folder is ready to deploy to Azure Static Web Apps.

## Recommended deployment path
1. Create a new private GitHub repository, for example `nova-recipe-builder`.
2. Upload all contents of this package to the root of that repository.
3. In the Azure Portal, create a Static Web App.
4. Choose GitHub as the source.
5. Choose the repository and main branch.
6. For build settings, use:
   - App location: `/`
   - API location: blank
   - Output location: blank
7. The included GitHub workflow uses `skip_app_build: true` because this is a plain static HTML/JS app.

## After deployment
1. Open the Azure Static Web Apps URL in Microsoft Edge.
2. Install using Edge menu > Apps > Install this site as an app.
3. In the installed app, click Choose Backup Folder.
4. Pick a synced OneDrive folder.
5. Use Backup JSON to save backups into OneDrive.

## Team data workflow
Each user/computer has its own local browser data. To share updates, export a JSON backup to OneDrive and have teammates import the latest JSON file.
