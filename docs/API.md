### REST API
The config manager provides a REST API for programmatic access:

```
GET    /api/config           # Get current config
POST   /api/config           # Update entire config
PATCH  /api/config/site      # Update site info (logo, tagline, about, devMode, defaultPreset)
GET    /api/projects         # Get all projects
POST   /api/projects         # Add a new project
PUT    /api/projects/<id>    # Update a project
DELETE /api/projects/<id>    # Delete a project
POST   /api/projects/reorder # Reorder projects
GET    /api/presets          # Get preset mappings
POST   /api/presets          # Add a preset mapping
PUT    /api/presets/<id>     # Rename a preset mapping
DELETE /api/presets/<id>     # Remove a preset mapping
GET    /api/preset-files     # List all preset files in presets/
GET    /api/preset-files/<filename>  # Get a preset file
PUT    /api/preset-files/<filename>  # Update/create a preset file
DELETE /api/preset-files/<filename>  # Delete a preset file
```

The API server (`3tomoe.py`) exposes:

```
GET  /api/health
GET  /api/weather
GET  /api/applications
GET  /api/execute-app?cmd=...
POST /api/execute-app
GET  /api/logs
```