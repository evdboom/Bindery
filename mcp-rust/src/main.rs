use async_trait::async_trait;
use rust_mcp_sdk::{
    error::SdkResult,
    macros::{mcp_tool, JsonSchema},
    mcp_server::{server_runtime, McpServerOptions, ServerHandler},
    schema::{
        CallToolError, CallToolRequestParams, CallToolResult, Implementation,
        InitializeResult, ListToolsResult, PaginatedRequestParams, ProtocolVersion,
        RpcError, ServerCapabilities, ServerCapabilitiesTools, TextContent,
    },
    McpServer, StdioTransport, ToMcpServerHandler, TransportOptions,
};
use rust_mcp_sdk::tool_box;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::sync::{Arc, Mutex};
use tracing_subscriber::{self, EnvFilter};

use bindery_mcp::{
    config::Config,
    embeddings,
    tools,
    TimingMs,
};

// ----------------------------------------------------------------------------
// Tool Definitions
// ----------------------------------------------------------------------------

#[mcp_tool(name = "health", description = "Return health and diagnostics for the MCP server")]
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct HealthTool {}

#[mcp_tool(name = "sync_workspace", description = "Deprecated: use index_build (sync is built-in)")]
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct SyncWorkspaceTool {
    #[serde(default)]
    pub direction: Option<String>,
    #[serde(default)]
    pub paths: Option<Vec<String>>,
    #[serde(default)]
    pub delete: Option<bool>,
    #[serde(default)]
    pub dry_run: Option<bool>,
}

fn default_index_language() -> String { "ALL".to_string() }

#[mcp_tool(name = "index_build", description = "Build or rebuild lexical/vector indices for all languages (EN+NL). Set background=true to run async and get a task_id.")]
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct IndexBuildTool {
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub act: Option<String>,
    #[serde(default)]
    pub chapter_range: Option<String>,
    #[serde(default)]
    pub force_rebuild: Option<bool>,
    #[serde(default)]
    pub require_synced: Option<bool>,
    #[serde(default)]
    pub sync_paths: Option<Vec<String>>,
    #[serde(default)]
    pub background: Option<bool>,
}

#[mcp_tool(name = "index_status", description = "Return index status and metadata")]
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct IndexStatusTool {}

#[mcp_tool(name = "retrieve_context", description = "Hybrid retrieval (BM25 + vector) for story context. Use language=EN, NL, or ALL.")]
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct RetrieveContextTool {
    pub query: String,
    #[serde(default = "default_index_language")]
    pub language: String,
    #[serde(default)]
    pub top_k: Option<u32>,
    #[serde(default)]
    pub act: Option<String>,
    #[serde(default)]
    pub chapter_range: Option<String>,
}

#[mcp_tool(name = "get_text", description = "Read text by identifier from the source repo (mount)")]
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct GetTextTool {
    pub language: String,
    pub identifier: String,
    #[serde(default)]
    pub start_line: Option<u32>,
    #[serde(default)]
    pub end_line: Option<u32>,
}

#[mcp_tool(name = "get_review_text", description = "Return git diff from the source repo (EN/NL/ALL)")]
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct GetReviewTextTool {
    #[serde(default = "default_review_language")]
    pub language: String,
    #[serde(default)]
    pub context_lines: Option<u32>,
}

fn default_review_language() -> String { "ALL".to_string() }

#[mcp_tool(name = "get_chapter", description = "Get a full chapter by number and language")]
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct GetChapterTool {
    pub chapter_number: u32,
    pub language: String,
}

#[mcp_tool(name = "get_overview", description = "Get an overview of acts and chapters")]
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct GetOverviewTool {
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub act: Option<u32>,
}

#[mcp_tool(name = "get_notes", description = "Get an entry from Notes/Details_Notes.md")]
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct GetNotesTool {
    pub category: String,
    pub name: String,
    #[serde(default)]
    pub match_index: Option<u32>,
}

#[mcp_tool(name = "format", description = "Format typography in markdown files under the source repo")]
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct FormatTool {
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub no_recurse: Option<bool>,
    #[serde(default)]
    pub dry_run: Option<bool>,
}

#[mcp_tool(name = "merge", description = "Merge markdown chapters into a book, optionally exporting DOCX/EPUB")]
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct MergeTool {
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_output_type")]
    pub output_type: String,
    #[serde(default)]
    pub root: Option<String>,
}

fn default_language() -> String { "EN".to_string() }
fn default_output_type() -> String { "md".to_string() }

#[mcp_tool(name = "search", description = "Literal or regex search under the source repo (mount)")]
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct SearchTool {
    pub query: String,
    #[serde(default)]
    pub regex: Option<bool>,
    #[serde(default)]
    pub case_sensitive: Option<bool>,
    #[serde(default)]
    pub max_results: Option<u32>,
}

#[mcp_tool(name = "task_status", description = "Check status of background tasks")]
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct TaskStatusTool {
    #[serde(default)]
    pub task_id: Option<String>,
}

/// Local input struct for index_build with background option
#[derive(Debug, Deserialize)]
struct IndexBuildInput {
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub act: Option<String>,
    #[serde(default)]
    pub chapter_range: Option<String>,
    #[serde(default)]
    pub force_rebuild: Option<bool>,
    #[serde(default)]
    pub require_synced: Option<bool>,
    #[serde(default)]
    pub sync_paths: Option<Vec<String>>,
    #[serde(default)]
    pub background: Option<bool>,
}

tool_box!(BinderyTools, [
    HealthTool,
    SyncWorkspaceTool,
    IndexBuildTool,
    IndexStatusTool,
    RetrieveContextTool,
    GetTextTool,
    GetReviewTextTool,
    GetChapterTool,
    GetOverviewTool,
    GetNotesTool,
    SearchTool,
    FormatTool,
    MergeTool,
    TaskStatusTool
]);

// ----------------------------------------------------------------------------
// Handler
// ----------------------------------------------------------------------------

#[derive(Clone)]
struct BinderyHandler {
    config: Arc<Config>,
    provider: Arc<dyn embeddings::provider::EmbeddingProvider>,
    last_retrieve: Arc<Mutex<Option<TimingMs>>>,
    task_manager: tools::tasks::TaskManager,
}

#[async_trait]
impl ServerHandler for BinderyHandler {
    async fn handle_list_tools_request(
        &self,
        _request: Option<PaginatedRequestParams>,
        _runtime: Arc<dyn McpServer>,
    ) -> Result<ListToolsResult, RpcError> {
        Ok(ListToolsResult {
            tools: BinderyTools::tools(),
            meta: None,
            next_cursor: None,
        })
    }

    async fn handle_call_tool_request(
        &self,
        params: CallToolRequestParams,
        _runtime: Arc<dyn McpServer>,
    ) -> Result<CallToolResult, CallToolError> {
        match params.name.as_str() {
            "health" => {
                let result = tools::health::health(&self.config, self.provider.as_ref(), self.last_retrieve.clone())
                    .map_err(|e| CallToolError::from_message(e.to_string()))?;
                Ok(json_result(&result)?)
            }
            "sync_workspace" => {
                let input: tools::sync_workspace::SyncInput = parse_args("sync_workspace", params.arguments)?;
                let result = tools::sync_workspace::sync_workspace(&self.config, input)
                    .map_err(|e| CallToolError::from_message(e.to_string()))?;
                Ok(json_result(&result)?)
            }
            "index_build" => {
                let input: IndexBuildInput = parse_args("index_build", params.arguments)?;
                let background = input.background.unwrap_or(false);

                if background {
                    let task_id = self.task_manager.create_task("index_build");
                    let config = self.config.clone();
                    let provider = self.provider.clone();
                    let manager = self.task_manager.clone();
                    let tid = task_id.clone();
                    let build_input = tools::index_build::IndexBuildInput {
                        scope: input.scope,
                        act: input.act,
                        chapter_range: input.chapter_range,
                        force_rebuild: input.force_rebuild,
                        require_synced: input.require_synced,
                        sync_paths: input.sync_paths,
                    };
                    std::thread::spawn(move || {
                        match tools::index_build::index_build(&config, provider.as_ref(), build_input) {
                            Ok(result) => {
                                let json = serde_json::to_value(&result).unwrap_or_default();
                                manager.complete_task(&tid, json);
                            }
                            Err(e) => {
                                manager.fail_task(&tid, e.to_string());
                            }
                        }
                    });
                    #[derive(Serialize)]
                    struct BackgroundResult { task_id: String, message: String }
                    let result = BackgroundResult {
                        task_id,
                        message: "Index build started in background. Use task_status to check progress.".to_string(),
                    };
                    Ok(json_result(&result)?)
                } else {
                    let build_input = tools::index_build::IndexBuildInput {
                        scope: input.scope,
                        act: input.act,
                        chapter_range: input.chapter_range,
                        force_rebuild: input.force_rebuild,
                        require_synced: input.require_synced,
                        sync_paths: input.sync_paths,
                    };
                    let result = tools::index_build::index_build(&self.config, self.provider.as_ref(), build_input)
                        .map_err(|e| CallToolError::from_message(e.to_string()))?;
                    Ok(json_result(&result)?)
                }
            }
            "index_status" => {
                let _input: tools::index_status::IndexStatusInput = parse_args("index_status", params.arguments)?;
                let result = tools::index_status::index_status(&self.config)
                    .map_err(|e| CallToolError::from_message(e.to_string()))?;
                Ok(json_result(&result)?)
            }
            "retrieve_context" => {
                let input: tools::retrieve_context::RetrieveContextInput = parse_args("retrieve_context", params.arguments)?;
                let result = tools::retrieve_context::retrieve_context(
                    &self.config,
                    self.provider.as_ref(),
                    input,
                    self.last_retrieve.clone(),
                ).map_err(|e| CallToolError::from_message(e.to_string()))?;
                Ok(json_result(&result)?)
            }
            "get_text" => {
                let input: tools::get_text::GetTextInput = parse_args("get_text", params.arguments)?;
                let result = tools::get_text::get_text(&self.config, input)
                    .map_err(|e| CallToolError::from_message(e.to_string()))?;
                Ok(json_result(&result)?)
            }
            "get_review_text" => {
                let input: tools::get_review_text::GetReviewTextInput = parse_args("get_review_text", params.arguments)?;
                let result = tools::get_review_text::get_review_text(&self.config, input)
                    .map_err(|e| CallToolError::from_message(e.to_string()))?;
                Ok(json_result(&result)?)
            }
            "get_chapter" => {
                let input: tools::get_chapter::GetChapterInput = parse_args("get_chapter", params.arguments)?;
                let result = tools::get_chapter::get_chapter(&self.config, input)
                    .map_err(|e| CallToolError::from_message(e.to_string()))?;
                Ok(json_result(&result)?)
            }
            "get_overview" => {
                let input: tools::get_overview::GetOverviewInput = parse_args("get_overview", params.arguments)?;
                let result = tools::get_overview::get_overview(&self.config, input)
                    .map_err(|e| CallToolError::from_message(e.to_string()))?;
                Ok(json_result(&result)?)
            }
            "get_notes" => {
                let input: tools::get_notes::GetNotesInput = parse_args("get_notes", params.arguments)?;
                let result = tools::get_notes::get_notes(&self.config, input)
                    .map_err(|e| CallToolError::from_message(e.to_string()))?;
                Ok(json_result(&result)?)
            }
            "search" => {
                let input: tools::search::SearchInput = parse_args("search", params.arguments)?;
                let result = tools::search::search(&self.config, input)
                    .map_err(|e| CallToolError::from_message(e.to_string()))?;
                Ok(json_result(&result)?)
            }
            "format" => {
                let input: tools::format::FormatInput = parse_args("format", params.arguments)?;
                let result = tools::format::format_markdown(&self.config, input)
                    .map_err(|e| CallToolError::from_message(e.to_string()))?;
                Ok(json_result(&result)?)
            }
            "merge" => {
                let input: tools::merge::MergeInput = parse_args("merge", params.arguments)?;
                let result = tools::merge::merge_book(&self.config, input)
                    .map_err(|e| CallToolError::from_message(e.to_string()))?;
                Ok(json_result(&result)?)
            }
            "task_status" => {
                let input: tools::tasks::TaskStatusInput = parse_args("task_status", params.arguments)?;
                let result = tools::tasks::task_status(&self.task_manager, input);
                Ok(json_result(&result)?)
            }
            _ => Err(CallToolError::unknown_tool(params.name)),
        }
    }
}

fn json_result<T: Serialize>(value: &T) -> Result<CallToolResult, CallToolError> {
    let mut map = Map::new();
    map.insert("result".to_string(), serde_json::to_value(value).map_err(|e| CallToolError::from_message(e.to_string()))?);
    Ok(CallToolResult::text_content(vec![TextContent::new("ok".to_string(), None, None)]).with_structured_content(map))
}

fn parse_args<T: for<'de> Deserialize<'de>>(tool_name: &str, args: Option<Map<String, Value>>) -> Result<T, CallToolError> {
    let value = Value::Object(args.unwrap_or_else(Map::new));
    serde_json::from_value(value).map_err(|e| CallToolError::invalid_arguments(tool_name, Some(e.to_string())))
}

#[tokio::main]
async fn main() -> SdkResult<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_writer(std::io::stderr)
        .init();

    let config = Config::from_env().map_err(|e| RpcError::internal_error().with_message(e.to_string()))?;
    let provider = embeddings::build_provider(&config).map_err(|e| RpcError::internal_error().with_message(e.to_string()))?;

    eprintln!("bindery-mcp | source={} | work={} | index={} | embeddings={}({})",
        config.source_root.to_string_lossy(),
        config.work_root.to_string_lossy(),
        config.index_dir.to_string_lossy(),
        provider.backend(),
        provider.model()
    );

    let handler = BinderyHandler {
        config: Arc::new(config),
        provider,
        last_retrieve: Arc::new(Mutex::new(None)),
        task_manager: tools::tasks::TaskManager::new(),
    };

    let server_info = InitializeResult {
        server_info: Implementation {
            name: "bindery-mcp".into(),
            version: "0.2.0".into(),
            title: Some("Bindery MCP".into()),
            description: Some("Bindery MCP server (hybrid retrieval + Ollama or ONNX embeddings, multi-language book export)".into()),
            icons: vec![],
            website_url: None,
        },
        capabilities: ServerCapabilities {
            tools: Some(ServerCapabilitiesTools { list_changed: None }),
            ..Default::default()
        },
        protocol_version: ProtocolVersion::V2025_11_25.into(),
        instructions: None,
        meta: None,
    };

    let transport = StdioTransport::new(TransportOptions::default())?;
    let options = McpServerOptions {
        server_details: server_info,
        transport,
        handler: handler.to_mcp_server_handler(),
        task_store: None,
        client_task_store: None,
    };
    let server = server_runtime::create_server(options);
    server.start().await
}
