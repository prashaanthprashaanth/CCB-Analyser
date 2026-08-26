using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("CCB Fault Analyser")]
[assembly: AssemblyDescription("Offline CCB brake Event Log analyser")]
[assembly: AssemblyCompany("CCB Brake Diagnostics")]
[assembly: AssemblyProduct("CCB Fault Analyser")]
[assembly: AssemblyVersion("2.1.0.0")]
[assembly: AssemblyFileVersion("2.1.0.0")]

internal static class Launcher
{
    private static readonly string[] AppFiles =
    {
        "index.html",
        "styles.css",
        "parser.js",
        "database.js",
        "app.js"
    };

    [STAThread]
    private static void Main()
    {
        try
        {
            string appDirectory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "CCB Fault Analyser");
            Directory.CreateDirectory(appDirectory);

            Assembly assembly = Assembly.GetExecutingAssembly();
            foreach (string fileName in AppFiles)
            {
                ExtractResource(assembly, fileName, Path.Combine(appDirectory, fileName));
            }

            string indexPath = Path.Combine(appDirectory, "index.html");
            string pageUrl = new Uri(indexPath).AbsoluteUri;
            string browserPath = FindAppBrowser();

            if (browserPath != null)
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = browserPath,
                    Arguments = "--new-window --app=\"" + pageUrl + "\"",
                    WorkingDirectory = appDirectory,
                    UseShellExecute = true
                });
            }
            else
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = indexPath,
                    WorkingDirectory = appDirectory,
                    UseShellExecute = true
                });
            }
        }
        catch (Exception error)
        {
            MessageBox.Show(
                "The CCB Fault Analyser could not start.\n\n" + error.Message,
                "CCB Fault Analyser",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    private static void ExtractResource(Assembly assembly, string resourceName, string destinationPath)
    {
        using (Stream source = assembly.GetManifestResourceStream(resourceName))
        {
            if (source == null)
            {
                throw new InvalidOperationException("Missing embedded application file: " + resourceName);
            }

            using (FileStream destination = new FileStream(destinationPath, FileMode.Create, FileAccess.Write, FileShare.Read))
            {
                source.CopyTo(destination);
            }
        }
    }

    private static string FindAppBrowser()
    {
        string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        string[] candidates =
        {
            Path.Combine(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe")
        };

        foreach (string candidate in candidates)
        {
            if (!String.IsNullOrWhiteSpace(candidate) && File.Exists(candidate))
            {
                return candidate;
            }
        }

        return null;
    }
}
