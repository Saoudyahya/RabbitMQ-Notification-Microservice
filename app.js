const express = require('express');
const amqp = require('amqplib');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const { Eureka } = require('eureka-js-client');
const winston = require('winston');

// Create a Winston logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`)
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'server.log' })
  ],
});

const app = express();
app.use(cors());
const port = 3002;

const rabbitMQUrl = 'amqp://localhost';
const queueName = 'IMPORT-EXPORT-QUEUE';

// HTTP server
const server = http.createServer(app);

// WebSocket server
const wss = new WebSocket.Server({ server });

// Store WebSocket clients
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  logger.info('New WebSocket connection');
  ws.on('close', () => {
    clients.delete(ws);
    logger.info('WebSocket connection closed');
  });
});

// Function to broadcast messages to all connected WebSocket clients
const broadcastMessage = (message) => {
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
  logger.info(`Broadcasted message to clients: ${message}`);
};

// RabbitMQ connection and message consumption
const consumeMessages = async () => {
  try {
    const connection = await amqp.connect(rabbitMQUrl);
    const channel = await connection.createChannel();
    await channel.assertQueue(queueName);

    logger.info(`Waiting for messages in ${queueName}`);

    channel.consume(queueName, (msg) => {
      if (msg !== null) {
        const messageContent = msg.content.toString();
        logger.info(`Received message: ${messageContent}`);

        // Broadcast the message to all WebSocket clients
        broadcastMessage(messageContent);

        channel.ack(msg);
      }
    });
  } catch (err) {
    logger.error('Error connecting to RabbitMQ:', err);
  }
};

// Start consuming messages
consumeMessages();

// HTTP endpoint to check server status
app.get('/api/status', (req, res) => {
  res.send('Server is running and connected to RabbitMQ');
});

// Eureka client configuration
const eurekaClient = new Eureka({
  instance: {
    app: 'Notification-Rabbitmq-service',
    hostName: 'localhost',
    ipAddr: '127.0.0.1',
    statusPageUrl: `http://localhost:${port}/api/status`,
    port: {
      '$': port,
      '@enabled': true,
    },
    vipAddress: 'Notification-Rabbitmq-service',
    dataCenterInfo: {
      '@class': 'com.netflix.appinfo.InstanceInfo$DefaultDataCenterInfo',
      name: 'MyOwn',
    },
  },
  eureka: {
    host: 'localhost',
    port: 8761,
    servicePath: '/eureka/apps/',
  },
});

eurekaClient.start((error) => {
  if (error) {
    logger.error('Eureka client failed to start:', error);
  } else {
    logger.info('Eureka client started successfully');
  }
});

server.listen(port, () => {
  logger.info(`Server is running on port ${port}`);
});
