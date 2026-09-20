#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequest,
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { tools, executeTool, setTopicMonitorInstance } from "./tools/index.js";
import { MattermostClient } from "./client.js";
import { loadConfig } from "./config.js";
import { TopicMonitor } from "./monitor/index.js";
import * as http from 'http';

async function main() {
  // Check for command-line arguments
  const runMonitoringImmediately = process.argv.includes('--run-monitoring');
  const exitAfterMonitoring = process.argv.includes('--exit-after-monitoring');
  
  console.error("Starting Mattermost MCP Server...");
  
  // Load configuration
  const config = loadConfig();
  
  // Initialize Mattermost client
  let client: MattermostClient;
  try {
    client = new MattermostClient();
    console.error("Successfully initialized Mattermost client");
  } catch (error) {
    console.error("Failed to initialize Mattermost client:", error);
    process.exit(1);
  }
  
  // Initialize and start topic monitor if enabled
  let topicMonitor: TopicMonitor | null = null;
  if (config.monitoring?.enabled) {
    try {
      console.error("Initializing topic monitor...");
      topicMonitor = new TopicMonitor(client, config.monitoring);
      // Set the TopicMonitor instance in the monitoring tool
      setTopicMonitorInstance(topicMonitor);
      await topicMonitor.start();
      console.error("Topic monitor started successfully");
    } catch (error) {
      console.error("Failed to initialize topic monitor:", error);
      // Continue without monitoring
    }
  } else {
    console.error("Topic monitoring is disabled in configuration");
  }
  
  // Initialize MCP server
  const server = new Server(
    {
      name: "Mattermost MCP Server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tool listing handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    console.error("Received ListToolsRequest");
    return {
      tools,
    };
  });

  // Register tool execution handler
  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
    console.error(`Received CallToolRequest for tool: ${request.params.name}`);
    
    try {
      if (!request.params.arguments) {
        throw new Error("No arguments provided");
      }

      return await executeTool(client, request.params.name, request.params.arguments);
    } catch (error) {
      console.error("Error executing tool:", error);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            }),
          },
        ],
        isError: true,
      };
    }
  });

  // Connect to transport
  const transport = new StdioServerTransport();
  console.error("Connecting server to transport...");
  await server.connect(transport);

  console.error("Mattermost MCP Server running on stdio");
  
  // Run monitoring immediately if requested
  if (runMonitoringImmediately && topicMonitor) {
    console.error("Running monitoring immediately as requested...");
    try {
      await topicMonitor.runNow();
      
      // Exit after monitoring if requested
      if (exitAfterMonitoring) {
        console.error("Exiting after monitoring as requested...");
        process.exit(0);
      }
    } catch (error) {
      console.error("Error running monitoring immediately:", error);
      
      // Exit with error code if exit-after-monitoring is set
      if (exitAfterMonitoring) {
        console.error("Exiting with error...");
        process.exit(1);
      }
    }
  }
  
  // Set up HTTP server for remote triggering of monitoring
  const httpPort = 3456; // Choose a port that's likely to be available
  const httpServer = http.createServer(async (req, res) => {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    
    // Only respond to specific paths
    if (req.url === '/run-monitoring') {
      console.error("Received HTTP request to run monitoring");
      
      if (topicMonitor) {
        try {
          console.error("Running monitoring via HTTP request...");
          await topicMonitor.runNow();
          console.error("Monitoring completed successfully");
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Monitoring completed successfully' }));
        } catch (error) {
          console.error("Error running monitoring:", error);
          
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: false, 
            error: error instanceof Error ? error.message : String(error) 
          }));
        }
      } else {
        console.error("Monitoring is not enabled or initialized");
        
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: 'Monitoring is not enabled or initialized' 
        }));
      }
    } else if (req.url === '/status') {
      // Status endpoint
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        status: 'running',
        monitoring: {
          enabled: !!topicMonitor,
          running: topicMonitor ? topicMonitor.isRunning() : false
        }
      }));
    } else {
      // Not found
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });
  
  // Start the HTTP server
  // A gateway can start a separate stdio process for each MCP session.
  // Only one process may bind the auxiliary monitoring port.
  if (process.env.MATTERMOST_DISABLE_MONITOR_HTTP !== 'true') {
    httpServer.listen(httpPort, () => {
      console.error(`HTTP server listening on port ${httpPort}`);
      console.error(`To trigger monitoring, visit http://localhost:${httpPort}/run-monitoring`);
      console.error(`To check status, visit http://localhost:${httpPort}/status`);
    });
  }
  
  // Handle process termination
  process.on('SIGINT', () => {
    console.error("Shutting down Mattermost MCP Server...");
    if (topicMonitor) {
      topicMonitor.stop();
    }
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
