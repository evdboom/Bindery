use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskInfo {
    pub task_id: String,
    pub task_type: String,
    pub status: TaskStatus,
    pub started_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub progress: Option<TaskProgress>,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskProgress {
    pub current: usize,
    pub total: usize,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskStatusInput {
    pub task_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskStatusResult {
    pub tasks: Vec<TaskInfo>,
}

#[derive(Clone)]
pub struct TaskManager {
    tasks: Arc<Mutex<HashMap<String, TaskInfo>>>,
}

impl Default for TaskManager {
    fn default() -> Self {
        Self::new()
    }
}

impl TaskManager {
    pub fn new() -> Self {
        Self {
            tasks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn create_task(&self, task_type: &str) -> String {
        let task_id = Uuid::new_v4().to_string();
        let task = TaskInfo {
            task_id: task_id.clone(),
            task_type: task_type.to_string(),
            status: TaskStatus::Running,
            started_at: Utc::now(),
            completed_at: None,
            progress: None,
            result: None,
            error: None,
        };
        self.tasks.lock().unwrap().insert(task_id.clone(), task);
        task_id
    }

    pub fn update_progress(&self, task_id: &str, current: usize, total: usize, message: Option<String>) {
        if let Ok(mut tasks) = self.tasks.lock() {
            if let Some(task) = tasks.get_mut(task_id) {
                task.progress = Some(TaskProgress { current, total, message });
            }
        }
    }

    pub fn complete_task(&self, task_id: &str, result: serde_json::Value) {
        if let Ok(mut tasks) = self.tasks.lock() {
            if let Some(task) = tasks.get_mut(task_id) {
                task.status = TaskStatus::Completed;
                task.completed_at = Some(Utc::now());
                task.result = Some(result);
            }
        }
    }

    pub fn fail_task(&self, task_id: &str, error: String) {
        if let Ok(mut tasks) = self.tasks.lock() {
            if let Some(task) = tasks.get_mut(task_id) {
                task.status = TaskStatus::Failed;
                task.completed_at = Some(Utc::now());
                task.error = Some(error);
            }
        }
    }

    pub fn get_task(&self, task_id: &str) -> Option<TaskInfo> {
        self.tasks.lock().ok()?.get(task_id).cloned()
    }

    pub fn get_all_tasks(&self) -> Vec<TaskInfo> {
        self.tasks.lock().ok().map(|t| t.values().cloned().collect()).unwrap_or_default()
    }

    pub fn cleanup_old_tasks(&self, max_age_hours: i64) {
        let cutoff = Utc::now() - chrono::Duration::hours(max_age_hours);
        if let Ok(mut tasks) = self.tasks.lock() {
            tasks.retain(|_, t| {
                t.status == TaskStatus::Running || t.started_at > cutoff
            });
        }
    }
}

pub fn task_status(manager: &TaskManager, input: TaskStatusInput) -> TaskStatusResult {
    // Cleanup old tasks first
    manager.cleanup_old_tasks(24);

    let tasks = if let Some(id) = input.task_id {
        manager.get_task(&id).into_iter().collect()
    } else {
        manager.get_all_tasks()
    };

    TaskStatusResult { tasks }
}
