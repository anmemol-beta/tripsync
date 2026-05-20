FROM node:22-alpine AS base
WORKDIR /app

# Install the official MongoDB MCP server.
RUN npm install -g @mongodb-js/mongodb-mcp-server@latest

# Restricted tool list: only the 4 primitives Tripsync uses.
# MDB_MCP_ALLOWED_TOOLS is a comma-separated list of tool names.
ENV MDB_MCP_ALLOWED_TOOLS="find,insert-one,update-one,aggregate"

# HTTP/SSE transport so Cloud Run can route requests.
ENV MDB_MCP_TRANSPORT="http"
ENV MDB_MCP_PORT="8080"

# MONGODB_URI must be injected at deploy time via Cloud Run --set-env-vars or Secret Manager.
# TODO(needs-user): set MDB_MCP_MONGODB_URI to your Atlas connection string.
ENV MDB_MCP_MONGODB_URI=""

EXPOSE 8080

CMD ["mongodb-mcp-server"]
