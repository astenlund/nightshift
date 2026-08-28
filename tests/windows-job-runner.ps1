param()

$ErrorActionPreference = 'Stop'

$script:MaxRunnerFrameBytes = 5592576
$script:RunnerCreationFlags = [long](0x4 -bor 0x400 -bor 0x80000 -bor 0x08000000)

$script:RunnerInteropSource = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace NightshiftRunner
{
    public class PipePair
    {
        public long ReadHandle;
        public long WriteHandle;
    }

    public class ChildProcess
    {
        public long ProcessHandle;
        public long ThreadHandle;
        public long ProcessId;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct SECURITY_ATTRIBUTES
    {
        public int nLength;
        public IntPtr lpSecurityDescriptor;
        [MarshalAs(UnmanagedType.Bool)]
        public bool bInheritHandle;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct STARTUPINFO
    {
        public int cb;
        public IntPtr lpReserved;
        public IntPtr lpDesktop;
        public IntPtr lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct STARTUPINFOEX
    {
        public STARTUPINFO StartupInfo;
        public IntPtr lpAttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
    {
        public long TotalUserTime;
        public long TotalKernelTime;
        public long ThisPeriodTotalUserTime;
        public long ThisPeriodTotalKernelTime;
        public uint TotalPageFaultCount;
        public uint TotalProcesses;
        public uint ActiveProcesses;
        public uint TotalTerminatedProcesses;
    }

    public class Interop
    {
        private Dictionary<long, IntPtr> attributeBuffers = new Dictionary<long, IntPtr>();

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CreatePipe(out IntPtr hReadPipe, out IntPtr hWritePipe, ref SECURITY_ATTRIBUTES lpPipeAttributes, uint nSize);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetHandleInformation(IntPtr hObject, uint dwMask, uint dwFlags);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern IntPtr CreateJobObjectW(IntPtr lpJobAttributes, string lpName);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetInformationJobObject(IntPtr hJob, int JobObjectInformationClass, IntPtr lpJobObjectInformation, uint cbJobObjectInformationLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool QueryInformationJobObject(IntPtr hJob, int JobObjectInformationClass, IntPtr lpJobObjectInformation, uint cbJobObjectInformationLength, IntPtr lpReturnLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool TerminateJobObject(IntPtr hJob, uint uExitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool InitializeProcThreadAttributeList(IntPtr lpAttributeList, int dwAttributeCount, int dwFlags, ref IntPtr lpSize);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool UpdateProcThreadAttribute(IntPtr lpAttributeList, uint dwFlags, IntPtr Attribute, IntPtr lpValue, IntPtr cbSize, IntPtr lpPreviousValue, IntPtr lpReturnSize);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern void DeleteProcThreadAttributeList(IntPtr lpAttributeList);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool CreateProcessW(string lpApplicationName, StringBuilder lpCommandLine, IntPtr lpProcessAttributes, IntPtr lpThreadAttributes, bool bInheritHandles, uint dwCreationFlags, IntPtr lpEnvironment, string lpCurrentDirectory, ref STARTUPINFOEX lpStartupInfo, out PROCESS_INFORMATION lpProcessInformation);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint ResumeThread(IntPtr hThread);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool TerminateProcess(IntPtr hProcess, uint uExitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr hObject);

        public PipePair CreateInheritablePipe()
        {
            SECURITY_ATTRIBUTES attributes = new SECURITY_ATTRIBUTES();
            attributes.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
            attributes.lpSecurityDescriptor = IntPtr.Zero;
            attributes.bInheritHandle = true;
            IntPtr read;
            IntPtr write;
            if (!CreatePipe(out read, out write, ref attributes, 0))
            {
                return null;
            }
            PipePair pair = new PipePair();
            pair.ReadHandle = read.ToInt64();
            pair.WriteHandle = write.ToInt64();
            return pair;
        }

        public bool ClearInherit(long handle)
        {
            return SetHandleInformation(new IntPtr(handle), 1, 0);
        }

        public long CreateJob()
        {
            return CreateJobObjectW(IntPtr.Zero, null).ToInt64();
        }

        public bool ConfigureJobKillOnClose(long job)
        {
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION information = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            information.BasicLimitInformation.LimitFlags = 0x2000;
            int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            IntPtr buffer = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(information, buffer, false);
                return SetInformationJobObject(new IntPtr(job), 9, buffer, (uint)size);
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }

        public long CreateAttributeListWithHandles(long first, long second, long third)
        {
            IntPtr size = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
            if (size == IntPtr.Zero)
            {
                return 0;
            }
            IntPtr list = Marshal.AllocHGlobal(size);
            if (!InitializeProcThreadAttributeList(list, 1, 0, ref size))
            {
                Marshal.FreeHGlobal(list);
                return 0;
            }
            IntPtr handleBuffer = Marshal.AllocHGlobal(IntPtr.Size * 3);
            Marshal.WriteIntPtr(handleBuffer, 0, new IntPtr(first));
            Marshal.WriteIntPtr(handleBuffer, IntPtr.Size, new IntPtr(second));
            Marshal.WriteIntPtr(handleBuffer, IntPtr.Size * 2, new IntPtr(third));
            if (!UpdateProcThreadAttribute(list, 0, new IntPtr(0x20002), handleBuffer, new IntPtr(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero))
            {
                DeleteProcThreadAttributeList(list);
                Marshal.FreeHGlobal(list);
                Marshal.FreeHGlobal(handleBuffer);
                return 0;
            }
            attributeBuffers[list.ToInt64()] = handleBuffer;
            return list.ToInt64();
        }

        public void DeleteAttributeList(long list)
        {
            IntPtr pointer = new IntPtr(list);
            DeleteProcThreadAttributeList(pointer);
            IntPtr handleBuffer;
            if (attributeBuffers.TryGetValue(list, out handleBuffer))
            {
                Marshal.FreeHGlobal(handleBuffer);
                attributeBuffers.Remove(list);
            }
            Marshal.FreeHGlobal(pointer);
        }

        public ChildProcess CreateSuspendedProcess(string applicationName, string commandLine, string environmentBlock, string workingDirectory, long stdinRead, long stdoutWrite, long stderrWrite, long attributeList, long creationFlags)
        {
            STARTUPINFOEX startupInformation = new STARTUPINFOEX();
            startupInformation.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
            startupInformation.StartupInfo.dwFlags = 0x100;
            startupInformation.StartupInfo.hStdInput = new IntPtr(stdinRead);
            startupInformation.StartupInfo.hStdOutput = new IntPtr(stdoutWrite);
            startupInformation.StartupInfo.hStdError = new IntPtr(stderrWrite);
            startupInformation.lpAttributeList = new IntPtr(attributeList);
            PROCESS_INFORMATION processInformation;
            IntPtr environmentPointer = Marshal.StringToHGlobalUni(environmentBlock);
            bool created;
            try
            {
                StringBuilder mutableCommandLine = new StringBuilder(commandLine);
                created = CreateProcessW(applicationName, mutableCommandLine, IntPtr.Zero, IntPtr.Zero, true, (uint)creationFlags, environmentPointer, workingDirectory, ref startupInformation, out processInformation);
            }
            finally
            {
                Marshal.FreeHGlobal(environmentPointer);
            }
            if (!created)
            {
                return null;
            }
            ChildProcess child = new ChildProcess();
            child.ProcessHandle = processInformation.hProcess.ToInt64();
            child.ThreadHandle = processInformation.hThread.ToInt64();
            child.ProcessId = (long)processInformation.dwProcessId;
            return child;
        }

        public bool AssignToJob(long job, long process)
        {
            return AssignProcessToJobObject(new IntPtr(job), new IntPtr(process));
        }

        public long Resume(long thread)
        {
            uint result = ResumeThread(new IntPtr(thread));
            if (result == 0xFFFFFFFF)
            {
                return -1;
            }
            return (long)result;
        }

        public bool Terminate(long process, long exitCode)
        {
            return TerminateProcess(new IntPtr(process), (uint)exitCode);
        }

        public long WaitForProcess(long process, long milliseconds)
        {
            return (long)WaitForSingleObject(new IntPtr(process), (uint)milliseconds);
        }

        public long GetExitCode(long process)
        {
            uint exitCode;
            if (!GetExitCodeProcess(new IntPtr(process), out exitCode))
            {
                return -1;
            }
            return (long)exitCode;
        }

        public long QueryActiveProcessCount(long job)
        {
            int size = Marshal.SizeOf(typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION));
            IntPtr buffer = Marshal.AllocHGlobal(size);
            try
            {
                if (!QueryInformationJobObject(new IntPtr(job), 1, buffer, (uint)size, IntPtr.Zero))
                {
                    return -1;
                }
                JOBOBJECT_BASIC_ACCOUNTING_INFORMATION information = (JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)Marshal.PtrToStructure(buffer, typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION));
                return (long)information.ActiveProcesses;
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }

        public bool TerminateJob(long job, long exitCode)
        {
            return TerminateJobObject(new IntPtr(job), (uint)exitCode);
        }

        public bool CloseHandle64(long handle)
        {
            return CloseHandle(new IntPtr(handle));
        }
    }
}
'@

function New-RunnerInterop {
    if ($null -eq ('NightshiftRunner.Interop' -as [type])) {
        Add-Type -TypeDefinition $script:RunnerInteropSource
    }

    return New-Object NightshiftRunner.Interop
}

function ConvertTo-RunnerCommandLine([string[]]$Elements) {
    $builder = New-Object System.Text.StringBuilder
    for ($index = 0; $index -lt $Elements.Count; $index++) {
        $element = $Elements[$index]
        if ($element.IndexOf([char]0) -ge 0) {
            throw 'command line element contains NUL'
        }
        if ($index -gt 0) {
            [void]$builder.Append(' ')
        }
        $needsQuotes = ($element.Length -eq 0)
        for ($scan = 0; $scan -lt $element.Length; $scan++) {
            $code = [int][char]$element[$scan]
            if ($code -eq 32 -or $code -eq 9 -or $code -eq 34) {
                $needsQuotes = $true
                break
            }
        }
        if (-not $needsQuotes) {
            [void]$builder.Append($element)
            continue
        }
        [void]$builder.Append([char]34)
        $backslashes = 0
        for ($scan = 0; $scan -lt $element.Length; $scan++) {
            $code = [int][char]$element[$scan]
            if ($code -eq 92) {
                $backslashes++
                continue
            }
            if ($code -eq 34) {
                [void]$builder.Append('\' * (2 * $backslashes + 1))
                [void]$builder.Append([char]34)
                $backslashes = 0
                continue
            }
            if ($backslashes -gt 0) {
                [void]$builder.Append('\' * $backslashes)
                $backslashes = 0
            }
            [void]$builder.Append($element[$scan])
        }
        if ($backslashes -gt 0) {
            [void]$builder.Append('\' * (2 * $backslashes))
        }
        [void]$builder.Append([char]34)
    }
    if ($builder.Length -gt 32766) {
        throw 'command line exceeds 32766 UTF-16 code units'
    }

    return $builder.ToString()
}

function ConvertTo-RunnerEnvironmentBlock($Pairs) {
    $items = @($Pairs)
    foreach ($pair in $items) {
        if ($pair.Name -isnot [string] -or $pair.Value -isnot [string] -or $pair.Name.Length -eq 0) {
            throw 'environment name is invalid'
        }
        if ($pair.Name.IndexOf('=') -ge 0 -or $pair.Name.IndexOf([char]0) -ge 0) {
            throw 'environment name is invalid'
        }
        if ($pair.Value.IndexOf([char]0) -ge 0) {
            throw 'environment value is invalid'
        }
    }
    if ($items.Count -eq 0) {
        return [string]([char]0) + [string]([char]0)
    }
    $names = New-Object string[] $items.Count
    $byExactName = New-Object System.Collections.Hashtable
    for ($index = 0; $index -lt $items.Count; $index++) {
        $names[$index] = $items[$index].Name
        if ($byExactName.ContainsKey($items[$index].Name)) {
            throw 'environment names are duplicated'
        }
        $byExactName[$items[$index].Name] = $items[$index]
    }
    [Array]::Sort($names, [System.StringComparer]::OrdinalIgnoreCase)
    $builder = New-Object System.Text.StringBuilder
    $blockLength = 1
    $previousName = $null
    foreach ($name in $names) {
        $pair = $byExactName[$name]
        if ($null -ne $previousName -and [string]::Compare($previousName, $pair.Name, [System.StringComparison]::OrdinalIgnoreCase) -eq 0) {
            throw 'environment names are duplicated'
        }
        $previousName = $pair.Name
        $item = $pair.Name + '=' + $pair.Value
        if ($item.Length + 1 -gt 32767) {
            throw 'environment item exceeds 32767 UTF-16 code units'
        }
        $blockLength = $blockLength + $item.Length + 1
        if ($blockLength -gt 32767) {
            throw 'environment block exceeds 32767 UTF-16 code units'
        }
        [void]$builder.Append($item)
        [void]$builder.Append([char]0)
    }
    [void]$builder.Append([char]0)

    return $builder.ToString()
}

function Test-RunnerExactKeys($Value, [string[]]$Expected) {
    if ($null -eq $Value -or $Value -isnot [System.Management.Automation.PSCustomObject]) {
        return $false
    }
    $actual = @($Value.psobject.Properties.Name)
    $orderedExpected = @($Expected | Sort-Object -CaseSensitive)

    return [string]::Join("`n", $actual) -ceq [string]::Join("`n", $orderedExpected)
}

function Close-RunnerHandleSet($Interop, $Handles) {
    foreach ($handle in $Handles) {
        if ($null -ne $handle -and $handle -ne 0) {
            [void]$Interop.CloseHandle64($handle)
        }
    }
}

function Start-RunnerChild {
    param($Interop, [string]$Executable, [string[]]$ArgumentList, $EnvironmentPairs, [string]$WorkingDirectory)
    try {
        $commandLine = ConvertTo-RunnerCommandLine (@($Executable) + @($ArgumentList))
        $environmentBlock = ConvertTo-RunnerEnvironmentBlock $EnvironmentPairs
    } catch {
        return New-Object psobject -Property @{ Status = 'spawn-failed' }
    }
    $jobHandle = [long]0
    $attributeList = [long]0
    $stdinPipe = $null
    $stdoutPipe = $null
    $stderrPipe = $null
    try {
        $jobHandle = $Interop.CreateJob()
        if ($jobHandle -eq 0) {
            throw 'job creation failed'
        }
        if (-not $Interop.ConfigureJobKillOnClose($jobHandle)) {
            throw 'job configuration failed'
        }
        $stdinPipe = $Interop.CreateInheritablePipe()
        if ($null -eq $stdinPipe) {
            throw 'stdin pipe creation failed'
        }
        if (-not $Interop.ClearInherit($stdinPipe.WriteHandle)) {
            throw 'stdin inherit clear failed'
        }
        $stdoutPipe = $Interop.CreateInheritablePipe()
        if ($null -eq $stdoutPipe) {
            throw 'stdout pipe creation failed'
        }
        if (-not $Interop.ClearInherit($stdoutPipe.ReadHandle)) {
            throw 'stdout inherit clear failed'
        }
        $stderrPipe = $Interop.CreateInheritablePipe()
        if ($null -eq $stderrPipe) {
            throw 'stderr pipe creation failed'
        }
        if (-not $Interop.ClearInherit($stderrPipe.ReadHandle)) {
            throw 'stderr inherit clear failed'
        }
        $attributeList = $Interop.CreateAttributeListWithHandles($stdinPipe.ReadHandle, $stdoutPipe.WriteHandle, $stderrPipe.WriteHandle)
        if ($attributeList -eq 0) {
            throw 'attribute list creation failed'
        }
    } catch {
        $handles = @()
        foreach ($pipe in @($stdinPipe, $stdoutPipe, $stderrPipe)) {
            if ($null -ne $pipe) {
                $handles += $pipe.ReadHandle
                $handles += $pipe.WriteHandle
            }
        }
        if ($attributeList -ne 0) {
            [void]$Interop.DeleteAttributeList($attributeList)
        }
        $handles += $jobHandle
        Close-RunnerHandleSet $Interop $handles

        return New-Object psobject -Property @{ Status = 'spawn-failed' }
    }
    $child = $null
    try {
        $child = $Interop.CreateSuspendedProcess($Executable, $commandLine, $environmentBlock, $WorkingDirectory, $stdinPipe.ReadHandle, $stdoutPipe.WriteHandle, $stderrPipe.WriteHandle, $attributeList, $script:RunnerCreationFlags)
    } catch {
        $child = $null
    }
    if ($null -eq $child) {
        [void]$Interop.DeleteAttributeList($attributeList)
        Close-RunnerHandleSet $Interop @($stdinPipe.ReadHandle, $stdinPipe.WriteHandle, $stdoutPipe.ReadHandle, $stdoutPipe.WriteHandle, $stderrPipe.ReadHandle, $stderrPipe.WriteHandle, $jobHandle)

        return New-Object psobject -Property @{ Status = 'spawn-failed' }
    }
    $preAssignmentFailed = $false
    foreach ($childCopy in @($stdinPipe.ReadHandle, $stdoutPipe.WriteHandle, $stderrPipe.WriteHandle)) {
        if (-not $Interop.CloseHandle64($childCopy)) {
            $preAssignmentFailed = $true
            break
        }
    }
    if (-not $preAssignmentFailed) {
        if (-not $Interop.AssignToJob($jobHandle, $child.ProcessHandle)) {
            $preAssignmentFailed = $true
        }
    }
    if ($preAssignmentFailed) {
        $terminated = $Interop.Terminate($child.ProcessHandle, 1)
        $signaled = $false
        if ($terminated) {
            $signaled = ($Interop.WaitForProcess($child.ProcessHandle, 5000) -eq 0)
        }
        if (-not ($terminated -and $signaled)) {
            return New-Object psobject -Property @{ Status = 'termination-unproven' }
        }
        [void]$Interop.DeleteAttributeList($attributeList)
        Close-RunnerHandleSet $Interop @($child.ProcessHandle, $child.ThreadHandle, $stdinPipe.WriteHandle, $stdoutPipe.ReadHandle, $stderrPipe.ReadHandle, $jobHandle)

        return New-Object psobject -Property @{ Status = 'spawn-failed' }
    }
    $resumeResult = $Interop.Resume($child.ThreadHandle)
    if ($resumeResult -lt 0) {
        [void]$Interop.TerminateJob($jobHandle, 1)
        if ($Interop.WaitForProcess($child.ProcessHandle, 5000) -ne 0) {
            return New-Object psobject -Property @{ Status = 'termination-unproven' }
        }
        [void]$Interop.DeleteAttributeList($attributeList)
        Close-RunnerHandleSet $Interop @($child.ProcessHandle, $child.ThreadHandle, $stdinPipe.WriteHandle, $stdoutPipe.ReadHandle, $stderrPipe.ReadHandle, $jobHandle)

        return New-Object psobject -Property @{ Status = 'spawn-failed' }
    }
    [void]$Interop.DeleteAttributeList($attributeList)

    return New-Object psobject -Property @{
        JobHandle = $jobHandle
        ProcessHandle = $child.ProcessHandle
        ProcessId = $child.ProcessId
        Status = 'started'
        StderrReadHandle = $stderrPipe.ReadHandle
        StdinWriteHandle = $stdinPipe.WriteHandle
        StdoutReadHandle = $stdoutPipe.ReadHandle
        ThreadHandle = $child.ThreadHandle
    }
}

function Send-RunnerFrame([string]$Json) {
    [Console]::Out.Write($Json + "`n")
    [Console]::Out.Flush()
}

function Read-RunnerTaskCount($Task) {
    try {
        return [int]$Task.Result
    } catch {
        return -1
    }
}

function Update-RunnerInputReader($Reader, $Stream, [long]$MaxBytes) {
    if ($Reader.Eof -or -not $Reader.Task.IsCompleted) {
        return $true
    }
    $count = Read-RunnerTaskCount $Reader.Task
    if ($count -le 0) {
        $Reader.Eof = $true

        return $true
    }
    for ($index = 0; $index -lt $count; $index++) {
        $byte = $Reader.Buffer[$index]
        if ($byte -eq 10) {
            $Reader.Lines.Enqueue($Reader.Pending.ToArray())
            $Reader.Pending.Clear()
        } else {
            [void]$Reader.Pending.Add($byte)
            if ($Reader.Pending.Count -gt $MaxBytes) {
                return $false
            }
        }
    }
    $Reader.Task = $Stream.ReadAsync($Reader.Buffer, 0, $Reader.Buffer.Length)

    return $true
}

function Update-RunnerChildStream($State) {
    if ($State.Eof -or -not $State.Task.IsCompleted) {
        return
    }
    $count = Read-RunnerTaskCount $State.Task
    if ($count -le 0) {
        $State.Eof = $true
        $State.Stream.Dispose()

        return
    }
    $encoded = [Convert]::ToBase64String($State.Buffer, 0, $count)
    Send-RunnerFrame ('{"dataBase64":"' + $encoded + '","kind":"' + $State.Kind + '","ordinal":' + $State.Ordinal + '}')
    $State.Ordinal = $State.Ordinal + 1
    $State.Task = $State.Stream.ReadAsync($State.Buffer, 0, $State.Buffer.Length)
}

function New-RunnerPipeStream([long]$Handle, [bool]$Writable) {
    $pointer = New-Object System.IntPtr -ArgumentList $Handle
    $safeHandle = New-Object Microsoft.Win32.SafeHandles.SafeFileHandle -ArgumentList @($pointer, $true)
    if ($Writable) {
        return New-Object System.IO.FileStream -ArgumentList @($safeHandle, [System.IO.FileAccess]::Write)
    }

    return New-Object System.IO.FileStream -ArgumentList @($safeHandle, [System.IO.FileAccess]::Read)
}

function Invoke-NightshiftJobRunner {
    try {
        $interop = New-RunnerInterop
        $maxFrameBytes = $script:MaxRunnerFrameBytes
        $hostInput = [Console]::OpenStandardInput()
        $utf8Strict = New-Object System.Text.UTF8Encoding -ArgumentList @($false, $true)
        $reader = @{
            Buffer = (New-Object byte[] 65536)
            Eof = $false
            Lines = (New-Object 'System.Collections.Generic.Queue[object]')
            Pending = (New-Object 'System.Collections.Generic.List[byte]')
            Task = $null
        }
        $reader.Task = $hostInput.ReadAsync($reader.Buffer, 0, $reader.Buffer.Length)
        $startLine = $null
        while ($null -eq $startLine) {
            if (-not (Update-RunnerInputReader $reader $hostInput $maxFrameBytes)) {
                exit 2
            }
            if ($reader.Lines.Count -gt 0) {
                $startLine = $reader.Lines.Dequeue()
                break
            }
            if ($reader.Eof) {
                exit 2
            }
            Start-Sleep -Milliseconds 15
        }
        $request = $utf8Strict.GetString($startLine) | ConvertFrom-Json
        if (-not (Test-RunnerExactKeys $request @('args', 'cwd', 'environment', 'executable', 'kind')) -or $request.kind -cne 'start') {
            exit 2
        }
        if ($request.executable -isnot [string] -or $request.cwd -isnot [string] -or $request.args -isnot [array]) {
            exit 2
        }
        $argumentList = @()
        foreach ($argument in @($request.args)) {
            if ($argument -isnot [string]) {
                exit 2
            }
            $argumentList += $argument
        }
        if ($request.environment -isnot [System.Management.Automation.PSCustomObject]) {
            exit 2
        }
        $environmentPairs = @()
        foreach ($property in $request.environment.psobject.Properties) {
            if ($property.Value -isnot [string]) {
                exit 2
            }
            $environmentPairs += New-Object psobject -Property @{ Name = $property.Name; Value = $property.Value }
        }
        $started = Start-RunnerChild -Interop $interop -Executable $request.executable -ArgumentList $argumentList -EnvironmentPairs $environmentPairs -WorkingDirectory $request.cwd
        if ($started.Status -eq 'spawn-failed') {
            Send-RunnerFrame '{"detailCode":"spawn","kind":"start-failed"}'
            exit 0
        }
        if ($started.Status -eq 'termination-unproven') {
            Send-RunnerFrame '{"detailCode":"termination","kind":"start-failed"}'
            while ($true) {
                Start-Sleep -Seconds 60
            }
        }
        Send-RunnerFrame ('{"kind":"started","pid":' + $started.ProcessId + '}')
        $childStdin = New-RunnerPipeStream $started.StdinWriteHandle $true
        $streams = @{
            Stderr = @{ Buffer = (New-Object byte[] 65536); Eof = $false; Kind = 'host-stderr'; Ordinal = 1; Stream = (New-RunnerPipeStream $started.StderrReadHandle $false); Task = $null }
            Stdout = @{ Buffer = (New-Object byte[] 65536); Eof = $false; Kind = 'host-stdout'; Ordinal = 1; Stream = (New-RunnerPipeStream $started.StdoutReadHandle $false); Task = $null }
        }
        $streams.Stdout.Task = $streams.Stdout.Stream.ReadAsync($streams.Stdout.Buffer, 0, $streams.Stdout.Buffer.Length)
        $streams.Stderr.Task = $streams.Stderr.Stream.ReadAsync($streams.Stderr.Buffer, 0, $streams.Stderr.Buffer.Length)
        $stdinOpen = $true
        $nextInputOrdinal = 1
        $processSignaled = $false
        $terminated = $false
        while ($true) {
            Update-RunnerChildStream $streams.Stdout
            Update-RunnerChildStream $streams.Stderr
            if (-not (Update-RunnerInputReader $reader $hostInput $maxFrameBytes)) {
                exit 2
            }
            while ($reader.Lines.Count -gt 0) {
                $frame = $utf8Strict.GetString($reader.Lines.Dequeue()) | ConvertFrom-Json
                if (Test-RunnerExactKeys $frame @('dataBase64', 'kind', 'ordinal')) {
                    if ($frame.kind -cne 'host-input' -or -not $stdinOpen -or $frame.ordinal -ne $nextInputOrdinal) {
                        exit 2
                    }
                    $decoded = [Convert]::FromBase64String($frame.dataBase64)
                    $childStdin.Write($decoded, 0, $decoded.Length)
                    $childStdin.Flush()
                    Send-RunnerFrame ('{"kind":"input-accepted","ordinal":' + $frame.ordinal + '}')
                    $nextInputOrdinal = $nextInputOrdinal + 1
                } elseif (Test-RunnerExactKeys $frame @('kind')) {
                    if ($frame.kind -ceq 'close-input') {
                        if (-not $stdinOpen) {
                            exit 2
                        }
                        $stdinOpen = $false
                        $childStdin.Dispose()
                    } elseif ($frame.kind -ceq 'terminate') {
                        $terminated = $true
                    } else {
                        exit 2
                    }
                } else {
                    exit 2
                }
            }
            if ($terminated) {
                if (-not $interop.TerminateJob($started.JobHandle, 1)) {
                    exit 2
                }
                break
            }
            if ($reader.Eof) {
                exit 2
            }
            if (-not $processSignaled) {
                if ($interop.WaitForProcess($started.ProcessHandle, 0) -eq 0) {
                    $processSignaled = $true
                }
            }
            if ($processSignaled -and $streams.Stdout.Eof -and $streams.Stderr.Eof) {
                if ($interop.QueryActiveProcessCount($started.JobHandle) -eq 0) {
                    break
                }
            }
            Start-Sleep -Milliseconds 15
        }
        while ($interop.QueryActiveProcessCount($started.JobHandle) -ne 0) {
            Start-Sleep -Milliseconds 15
        }
        while ($interop.WaitForProcess($started.ProcessHandle, 0) -ne 0) {
            Start-Sleep -Milliseconds 15
        }
        while (-not ($streams.Stdout.Eof -and $streams.Stderr.Eof)) {
            Update-RunnerChildStream $streams.Stdout
            Update-RunnerChildStream $streams.Stderr
            if (-not ($streams.Stdout.Eof -and $streams.Stderr.Eof)) {
                Start-Sleep -Milliseconds 15
            }
        }
        $exitCode = $interop.GetExitCode($started.ProcessHandle)
        if ($exitCode -lt 0) {
            exit 2
        }
        Send-RunnerFrame ('{"exitCode":' + $exitCode + ',"kind":"host-exit"}')
        Send-RunnerFrame '{"kind":"job-empty"}'
        if ($stdinOpen) {
            $stdinOpen = $false
            $childStdin.Dispose()
        }
        [void]$interop.CloseHandle64($started.ThreadHandle)
        [void]$interop.CloseHandle64($started.ProcessHandle)
        [void]$interop.CloseHandle64($started.JobHandle)
        exit 0
    } catch {
        exit 2
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    Invoke-NightshiftJobRunner
}
