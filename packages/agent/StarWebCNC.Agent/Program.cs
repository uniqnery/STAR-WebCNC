using StarWebCNC.Agent.Collectors;
using StarWebCNC.Agent.Commands;
using StarWebCNC.Agent.Configuration;
using StarWebCNC.Agent.Focas;
using StarWebCNC.Agent.Mqtt;
using StarWebCNC.Agent.Template;

var builder = Host.CreateApplicationBuilder(args);

// Configuration
builder.Services.Configure<AgentSettings>(
    builder.Configuration.GetSection(AgentSettings.SectionName));

// HTTP Client for Server API
builder.Services.AddHttpClient("ServerApi", (sp, client) =>
{
    var settings = builder.Configuration
        .GetSection(AgentSettings.SectionName)
        .Get<AgentSettings>();

    client.BaseAddress = new Uri(settings?.Server.BaseUrl ?? "http://localhost:3000");
    client.Timeout = TimeSpan.FromSeconds(settings?.Server.TimeoutSeconds ?? 30);
});

// Memory Cache
builder.Services.AddMemoryCache();

// FOCAS Services
builder.Services.AddSingleton<FocasConnection>();
builder.Services.AddSingleton<FocasDataReader>();

// MQTT Service
builder.Services.AddSingleton<MqttService>();

// Template Loader
builder.Services.AddSingleton<TemplateLoader>();

// Command Handler
builder.Services.AddSingleton<CommandHandler>();

// Background Service
builder.Services.AddHostedService<DataCollectorService>();

// Build and run
var host = builder.Build();

// Register command handlers
var commandHandler = host.Services.GetRequiredService<CommandHandler>();
commandHandler.RegisterHandlers();

Console.WriteLine(@"
╔═══════════════════════════════════════════════════════╗
║           Star-WebCNC Field Agent                     ║
╠═══════════════════════════════════════════════════════╣
║  Press Ctrl+C to stop                                 ║
╚═══════════════════════════════════════════════════════╝
");

await host.RunAsync();
