# VexonTV Telegram Integration

This guide explains how to use Telegram as a source provider in VexonTV to browse and manage IPTV playlists through a Telegram bot.

## Overview

The Telegram integration allows you to:

1. **Add a Telegram bot token** in the VexonTV app (Add Source → Telegram Bot)
2. **Load M3U playlists** via Telegram commands (`/load <url>`)
3. **Browse channels by category** using inline buttons
4. **Add/remove favorites** directly from Telegram
5. **Sync favorites** between Telegram and VexonTV

## Prerequisites

### 1. Create a Telegram Bot

1. Open Telegram and search for **@BotFather**
2. Start a chat and send `/newbot`
3. Choose a name for your bot
4. Save the **bot token** (format: `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`)

### 2. Set Up the VexonTV Server

The Telegram bot API server runs separately and communicates with VexonTV via HTTP.

**Install dependencies:**
```bash
cd /home/sanjaybyranna/Desktop/VexonTV
pnpm install
```

**Start the Telegram API server:**
```bash
BOT_TOKEN=your_bot_token_here node server/api.js
```

The server will start on `http://localhost:3000` by default. You can change this with the `TELEGRAM_API_PORT` environment variable.

**For production, consider using PM2 or a similar process manager:**
```bash
npm install -g pm2
pm2 start server/api.js --name "vexontv-telegram" --env "BOT_TOKEN=your_token_here"
```

## Usage in VexonTV

### Adding a Telegram Source

1. On the TV, navigate to **Add source**
2. Select **Telegram Bot**
3. Enter your **Bot Token** (from @BotFather)
4. Give it a name (optional)
5. Press **OK** to save

The bot will now be running and ready to receive commands.

### Using the Telegram Bot

**Commands:**
- `/start` - Welcome message and instructions
- `/help` - List all available commands
- `/load <m3u_url>` - Load an M3U playlist
  - Example: `/load https://example.com/playlist.m3u`
- `/favorites` - View your saved favorite channels
- `/status` - Check bot status
- `/clear` - Clear all saved data

**Navigation:**
- Use inline buttons to browse categories
- Select a channel to view details
- Use **Test Stream** to verify if a channel is online
- Use **Add to Favorites** to save channels
- Your favorites persist even when you reload the playlist

### Viewing Favorites in VexonTV

Favorites added via Telegram are automatically available in VexonTV's favorites list when the Telegram bot is running.

## File Structure

```
VexonTV/
├── server/
│   ├── telegram-bot.js        # Bot class with all Telegram handlers
│   ├── telegram-manager.js    # Bot lifecycle management
│   └── api.js                 # HTTP API server
├── js/
│   ├── telegram-client.js     # Client for communicating with API server
│   ├── api.js                 # Updated with Telegram support
│   ├── store.js               # Updated with Telegram source handling
│   └── ui/
│       └── screens/
│           └── add.js         # UI already has Telegram option
└── package.json               # Updated with dependencies
```

## Architecture

### 1. **Telegram Bot (Node.js)**
   - Runs on a server or your computer
   - Handles user interactions via Telegram
   - Manages M3U playlists and favorites
   - Stores data in `server/favorites.json`

### 2. **API Server (Express)**
   - Exposes HTTP endpoints for bot management
   - Allows VexonTV to start/stop bots
   - Syncs favorites between systems
   - Port: `3000` (configurable)

### 3. **VexonTV App (TV Browser)**
   - Displays Telegram as a source type
   - Communicates with API server to manage bots
   - Displays favorites from Telegram
   - No internet required after initial setup

## API Endpoints

The API server exposes the following endpoints (used internally by VexonTV):

### Start Bot
```bash
POST /api/telegram/start
Content-Type: application/json

{
  "token": "123456:ABC-DEF1234...",
  "name": "My Telegram Bot"
}
```

### Stop Bot
```bash
POST /api/telegram/stop
Content-Type: application/json

{
  "token": "123456:ABC-DEF1234..."
}
```

### Check Bot Status
```bash
GET /api/telegram/status
```

### Is Bot Running
```bash
GET /api/telegram/is-running/:token
```

### Get Favorites
```bash
GET /api/telegram/favorites/:token/:chatId
```

### Get Active Bots
```bash
GET /api/telegram/active-tokens
```

### Health Check
```bash
GET /health
```

## Troubleshooting

### Bot Won't Start
- **Check the token format:** It should be `digits:alphanumeric-with-underscores-and-dashes`
- **Verify @BotFather token:** Open Telegram and ask @BotFather for `/mybots` to see your tokens
- **Check API server:** Make sure the Telegram API server is running on port 3000

### Favorites Not Syncing
- Ensure the Telegram API server is running
- Check that the bot is marked as "running" in VexonTV status
- Verify network connectivity between TV and server

### Playlist Won't Load
- **Check the URL:** Make sure it's a valid M3U playlist URL
- **Test the URL:** Try opening it in a browser first
- **Server timeout:** Some servers take time to respond; the bot waits up to 30 seconds

### Bot Stops Working After Adding
1. Check if the bot is still running: `/status` in Telegram
2. Restart the API server: Stop and restart `server/api.js`
3. Re-add the Telegram source in VexonTV

## Environment Variables

Create a `.env` file in the root directory:

```env
BOT_TOKEN=your_bot_token_here
TELEGRAM_API_PORT=3000
```

The `BOT_TOKEN` is used if you're running the standalone bot server directly. For VexonTV, the token is managed through the API server.

## Security Notes

- **Bot Token**: Keep your bot token secret. Never share it publicly.
- **Favorites Storage**: Favorites are stored in `server/favorites.json`. Keep this file private.
- **Local Network**: The API server communicates over HTTP. Use on a trusted local network only.
- **Production**: If exposing the API server to the internet, add authentication (not implemented in base version).

## Advanced: Running Multiple Bots

You can run multiple Telegram bots simultaneously by adding multiple Telegram sources with different bot tokens:

1. Create multiple bots with @BotFather
2. In VexonTV, add each token as a separate source
3. Each bot will run independently and store its own favorites

## Stopping a Bot

### Option 1: From VexonTV
1. Go to **Sources**
2. Find the Telegram bot
3. Delete it (favorites are kept)

### Option 2: Stop API Server
```bash
# Press Ctrl+C in the terminal running the API server
```

## Future Enhancements

Potential features for future versions:

- [ ] Sync favorites back to VexonTV
- [ ] Filter channels by language
- [ ] Set favorites as bookmarks for quick access
- [ ] Inline search within the bot
- [ ] Channel preview in Telegram
- [ ] Statistics on watched channels
- [ ] Multi-device sync
- [ ] Web interface for bot management

## Support

For issues or questions:

1. Check the **Troubleshooting** section above
2. Review bot logs: Check the terminal where you started `server/api.js`
3. Verify Telegram bot is responding: Send `/help` in the chat
4. Test API connection: `curl http://localhost:3000/health`

## License

Same as VexonTV - MIT License
