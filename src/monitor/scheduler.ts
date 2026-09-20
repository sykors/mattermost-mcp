import cron, { type ScheduledTask } from 'node-cron';
import { MonitoringConfig } from '../config.js';

type TaskFunction = () => Promise<void>;

/**
 * Scheduler class for managing cron jobs
 */
export class Scheduler {
  private task: ScheduledTask | null = null;
  private config: MonitoringConfig;
  private taskFn: TaskFunction;

  /**
   * Creates a new scheduler
   * @param config Monitoring configuration
   * @param taskFn Function to execute on schedule
   */
  constructor(config: MonitoringConfig, taskFn: TaskFunction) {
    this.config = config;
    this.taskFn = taskFn;
  }

  /**
   * Starts the scheduled task
   */
  start(): void {
    if (this.task) {
      console.error('Task is already running');
      return;
    }

    try {
      // Validate cron expression
      if (!cron.validate(this.config.schedule)) {
        throw new Error(`Invalid cron expression: ${this.config.schedule}`);
      }

      // Schedule the task
      this.task = cron.schedule(this.config.schedule, async () => {
        try {
          console.error(`[${new Date().toISOString()}] Running scheduled monitoring task`);
          await this.taskFn();
        } catch (error) {
          console.error('Error in scheduled task:', error);
        }
      });

      console.error(`Monitoring scheduler started with schedule: ${this.config.schedule}`);
    } catch (error) {
      console.error('Failed to start scheduler:', error);
      throw error;
    }
  }

  /**
   * Stops the scheduled task
   */
  stop(): void {
    if (!this.task) {
      console.error('No task is running');
      return;
    }

    this.task.stop();
    this.task = null;
    console.error('Monitoring scheduler stopped');
  }

  /**
   * Updates the scheduler configuration
   * @param config New monitoring configuration
   */
  updateConfig(config: MonitoringConfig): void {
    this.config = config;
    
    // Restart the task if it's running
    if (this.task) {
      this.stop();
      this.start();
    }
  }

  /**
   * Checks if the scheduler is running
   * @returns True if the scheduler is running, false otherwise
   */
  isRunning(): boolean {
    return this.task !== null;
  }

  /**
   * Runs the task immediately, regardless of schedule
   */
  async runNow(): Promise<void> {
    try {
      console.error(`[${new Date().toISOString()}] Running monitoring task manually`);
      await this.taskFn();
    } catch (error) {
      console.error('Error in manual task execution:', error);
      throw error;
    }
  }
}
