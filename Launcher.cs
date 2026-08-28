using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Net;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("CCB Fault Analyser")]
[assembly: AssemblyDescription("Shared LAN CCB brake Event Log analyser")]
[assembly: AssemblyCompany("CCB Brake Diagnostics")]
[assembly: AssemblyProduct("CCB Fault Analyser")]
[assembly: AssemblyVersion("3.0.0.0")]
[assembly: AssemblyFileVersion("3.0.0.0")]

internal static class Launcher
{
    private const int Port = 8080;
    private const string LocalUrl = "http://127.0.0.1:8080/";

    [STAThread]
    private static void Main()
    {
        try
        {
            string appDirectory = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            string serverPath = Path.Combine(appDirectory, "server.py");
            if (!File.Exists(serverPath))
            {
                throw new FileNotFoundException("The LAN server file is missing.", serverPath);
            }

            if (!ServerIsReady())
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = "pyw.exe",
                    Arguments = "-3 \"" + serverPath + "\" --host 0.0.0.0 --port " + Port + " --advertise-host 10.189.34.5",
                    WorkingDirectory = appDirectory,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                });

                for (int attempt = 0; attempt < 40 && !ServerIsReady(); attempt++)
                {
                    Thread.Sleep(250);
                }
                if (!ServerIsReady())
                {
                    throw new InvalidOperationException("The shared server did not start. Run start_lan_server.cmd to see the server error.");
                }
            }

            string browserPath = FindAppBrowser();

            if (browserPath != null)
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = browserPath,
                    Arguments = "--new-window --app=\"" + LocalUrl + "\"",
                    WorkingDirectory = appDirectory,
                    UseShellExecute = true
                });
            }
            else
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = LocalUrl,
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

    private static bool ServerIsReady()
    {
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(LocalUrl + "api/health");
            request.Method = "GET";
            request.Timeout = 500;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            {
                return response.StatusCode == HttpStatusCode.OK;
            }
        }
        catch
        {
            return false;
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
