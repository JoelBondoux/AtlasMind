#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Starts one ACP agent on a private Windows desktop while preserving stdio.
//!
//! This is deliberately a process, not an in-process native addon. A malformed
//! third-party command line or a Windows API failure can take this helper down
//! without taking VS Code's extension host with it. The helper has one job:
//! create a desktop, put the requested process on it, wait, and return the same
//! exit code. It never switches to that desktop and never opens a network
//! endpoint.

use std::env;
use std::ffi::{OsStr, OsString, c_void};
use std::io;
use std::mem::{size_of, zeroed};
use std::os::windows::ffi::OsStrExt;
use std::ptr::{null, null_mut};

type Bool = i32;
type Dword = u32;
type Handle = *mut c_void;
type Hdesk = Handle;
type Lpvoid = *mut c_void;
type SizeT = usize;

const FALSE: Bool = 0;
const TRUE: Bool = 1;
const INFINITE: Dword = 0xffff_ffff;
const WAIT_FAILED: Dword = 0xffff_ffff;
const DESKTOP_CREATEWINDOW: Dword = 0x0000_0002;
const STARTF_USESHOWWINDOW: Dword = 0x0000_0001;
const STARTF_USESTDHANDLES: Dword = 0x0000_0100;
const EXTENDED_STARTUPINFO_PRESENT: Dword = 0x0008_0000;
const CREATE_SUSPENDED: Dword = 0x0000_0004;
const CREATE_NO_WINDOW: Dword = 0x0800_0000;
const STD_INPUT_HANDLE: Dword = (-10_i32) as Dword;
const STD_OUTPUT_HANDLE: Dword = (-11_i32) as Dword;
const STD_ERROR_HANDLE: Dword = (-12_i32) as Dword;
const PROC_THREAD_ATTRIBUTE_HANDLE_LIST: usize = 0x0002_0002;
const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS: i32 = 9;
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: Dword = 0x0000_2000;

#[repr(C)]
struct StartupInfoW {
    cb: Dword,
    reserved: *mut u16,
    desktop: *mut u16,
    title: *mut u16,
    x: Dword,
    y: Dword,
    x_size: Dword,
    y_size: Dword,
    x_count_chars: Dword,
    y_count_chars: Dword,
    fill_attribute: Dword,
    flags: Dword,
    show_window: u16,
    reserved2_bytes: u16,
    reserved2: *mut u8,
    std_input: Handle,
    std_output: Handle,
    std_error: Handle,
}

#[repr(C)]
struct StartupInfoExW {
    startup_info: StartupInfoW,
    attribute_list: Lpvoid,
}

#[repr(C)]
struct ProcessInformation {
    process: Handle,
    thread: Handle,
    process_id: Dword,
    thread_id: Dword,
}

#[repr(C)]
struct JobObjectBasicLimitInformation {
    per_process_user_time_limit: i64,
    per_job_user_time_limit: i64,
    limit_flags: Dword,
    minimum_working_set_size: usize,
    maximum_working_set_size: usize,
    active_process_limit: Dword,
    affinity: usize,
    priority_class: Dword,
    scheduling_class: Dword,
}

#[repr(C)]
struct IoCounters {
    read_operation_count: u64,
    write_operation_count: u64,
    other_operation_count: u64,
    read_transfer_count: u64,
    write_transfer_count: u64,
    other_transfer_count: u64,
}

#[repr(C)]
struct JobObjectExtendedLimitInformation {
    basic_limit_information: JobObjectBasicLimitInformation,
    io_info: IoCounters,
    process_memory_limit: usize,
    job_memory_limit: usize,
    peak_process_memory_used: usize,
    peak_job_memory_used: usize,
}

#[link(name = "user32")]
unsafe extern "system" {
    fn CreateDesktopW(
        desktop: *const u16,
        device: *const u16,
        device_mode: Lpvoid,
        flags: Dword,
        desired_access: Dword,
        security_attributes: Lpvoid,
    ) -> Hdesk;
    fn CloseDesktop(desktop: Hdesk) -> Bool;
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn CloseHandle(handle: Handle) -> Bool;
    fn CreateJobObjectW(job_attributes: Lpvoid, name: *const u16) -> Handle;
    fn CreateProcessW(
        application_name: *const u16,
        command_line: *mut u16,
        process_attributes: Lpvoid,
        thread_attributes: Lpvoid,
        inherit_handles: Bool,
        creation_flags: Dword,
        environment: Lpvoid,
        current_directory: *const u16,
        startup_info: *mut StartupInfoW,
        process_information: *mut ProcessInformation,
    ) -> Bool;
    fn DeleteProcThreadAttributeList(attribute_list: Lpvoid);
    fn GetCurrentProcessId() -> Dword;
    fn GetExitCodeProcess(process: Handle, exit_code: *mut Dword) -> Bool;
    fn GetStdHandle(std_handle: Dword) -> Handle;
    fn InitializeProcThreadAttributeList(
        attribute_list: Lpvoid,
        attribute_count: Dword,
        flags: Dword,
        size: *mut SizeT,
    ) -> Bool;
    fn UpdateProcThreadAttribute(
        attribute_list: Lpvoid,
        flags: Dword,
        attribute: usize,
        value: Lpvoid,
        size: SizeT,
        previous_value: Lpvoid,
        return_size: *mut SizeT,
    ) -> Bool;
    fn AssignProcessToJobObject(job: Handle, process: Handle) -> Bool;
    fn ResumeThread(thread: Handle) -> Dword;
    fn SetInformationJobObject(
        job: Handle,
        information_class: i32,
        information: Lpvoid,
        information_length: Dword,
    ) -> Bool;
    fn TerminateProcess(process: Handle, exit_code: u32) -> Bool;
    fn WaitForSingleObject(handle: Handle, milliseconds: Dword) -> Dword;
}

struct Desktop(Hdesk);

impl Drop for Desktop {
    fn drop(&mut self) {
        // SAFETY: the handle came from CreateDesktopW and is closed exactly once.
        unsafe {
            CloseDesktop(self.0);
        }
    }
}

struct AttributeList(Lpvoid);

impl Drop for AttributeList {
    fn drop(&mut self) {
        // SAFETY: initialization succeeded before this owner was constructed.
        unsafe {
            DeleteProcThreadAttributeList(self.0);
        }
    }
}

struct OwnedHandle(Handle);

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        // SAFETY: CreateProcessW returned these real handles to this process.
        unsafe {
            CloseHandle(self.0);
        }
    }
}

fn wide(value: &OsStr) -> Vec<u16> {
    value.encode_wide().chain(Some(0)).collect()
}

/// Quote one argv element according to the CommandLineToArgvW/MSVCRT rules.
fn quote_argument(value: &OsStr) -> OsString {
    let text = value.to_string_lossy();
    if !text.is_empty() && !text.chars().any(|ch| ch.is_whitespace() || ch == '"') {
        return value.to_os_string();
    }

    let mut quoted = String::from("\"");
    let mut slashes = 0usize;
    for ch in text.chars() {
        if ch == '\\' {
            slashes += 1;
            continue;
        }
        if ch == '"' {
            quoted.push_str(&"\\".repeat(slashes * 2 + 1));
            quoted.push('"');
        } else {
            quoted.push_str(&"\\".repeat(slashes));
            quoted.push(ch);
        }
        slashes = 0;
    }
    quoted.push_str(&"\\".repeat(slashes * 2));
    quoted.push('"');
    quoted.into()
}

fn command_line(arguments: &[OsString]) -> Vec<u16> {
    let mut line = OsString::new();
    for (index, argument) in arguments.iter().enumerate() {
        if index > 0 {
            line.push(" ");
        }
        line.push(quote_argument(argument));
    }
    wide(&line)
}

fn launch(arguments: Vec<OsString>) -> io::Result<u32> {
    let Some(application) = arguments.first() else {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "expected the ACP executable after --",
        ));
    };

    // A process-unique name prevents one extension host from attaching a new
    // child to another host's desktop. CreateDesktop inherits the window
    // station's ACL and the handle itself is deliberately non-inheritable.
    let desktop_leaf = format!("AtlasMindAcp-{}", unsafe { GetCurrentProcessId() });
    let desktop_leaf_wide = wide(OsStr::new(&desktop_leaf));
    let desktop = unsafe {
        CreateDesktopW(
            desktop_leaf_wide.as_ptr(),
            null(),
            null_mut(),
            0,
            // The launcher only needs to keep the desktop alive while the
            // child runs. Ask for the one access right CreateDesktop requires,
            // not GENERIC_ALL over a UI object in the interactive station.
            DESKTOP_CREATEWINDOW,
            null_mut(),
        )
    };
    if desktop.is_null() {
        return Err(io::Error::last_os_error());
    }
    let _desktop_owner = Desktop(desktop);
    let mut desktop_path = wide(OsStr::new(&format!("WinSta0\\{desktop_leaf}")));

    let mut attribute_bytes = 0usize;
    unsafe {
        // The first call is documented to fail while returning the required size.
        InitializeProcThreadAttributeList(null_mut(), 1, 0, &mut attribute_bytes);
    }
    if attribute_bytes == 0 {
        return Err(io::Error::last_os_error());
    }
    let word_count = attribute_bytes.div_ceil(size_of::<usize>());
    let mut attribute_storage = vec![0usize; word_count];
    let attribute_pointer = attribute_storage.as_mut_ptr().cast::<c_void>();
    if unsafe { InitializeProcThreadAttributeList(attribute_pointer, 1, 0, &mut attribute_bytes) }
        == FALSE
    {
        return Err(io::Error::last_os_error());
    }
    let _attribute_owner = AttributeList(attribute_pointer);

    let mut standard_handles = unsafe {
        [
            GetStdHandle(STD_INPUT_HANDLE),
            GetStdHandle(STD_OUTPUT_HANDLE),
            GetStdHandle(STD_ERROR_HANDLE),
        ]
    };
    if standard_handles
        .iter()
        .any(|handle| handle.is_null() || *handle as isize == -1)
    {
        return Err(io::Error::new(
            io::ErrorKind::BrokenPipe,
            "the launcher did not inherit all three standard streams",
        ));
    }
    if unsafe {
        UpdateProcThreadAttribute(
            attribute_pointer,
            0,
            PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
            standard_handles.as_mut_ptr().cast::<c_void>(),
            size_of::<Handle>() * standard_handles.len(),
            null_mut(),
            null_mut(),
        )
    } == FALSE
    {
        return Err(io::Error::last_os_error());
    }

    let mut startup: StartupInfoExW = unsafe { zeroed() };
    startup.startup_info.cb = size_of::<StartupInfoExW>() as Dword;
    startup.startup_info.desktop = desktop_path.as_mut_ptr();
    startup.startup_info.flags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
    startup.startup_info.show_window = 0;
    startup.startup_info.std_input = standard_handles[0];
    startup.startup_info.std_output = standard_handles[1];
    startup.startup_info.std_error = standard_handles[2];
    startup.attribute_list = attribute_pointer;

    let application_wide = wide(application);
    let mut command_line_wide = command_line(&arguments);
    let mut process: ProcessInformation = unsafe { zeroed() };
    let created = unsafe {
        CreateProcessW(
            application_wide.as_ptr(),
            command_line_wide.as_mut_ptr(),
            null_mut(),
            null_mut(),
            TRUE,
            EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW | CREATE_SUSPENDED,
            null_mut(),
            null(),
            &mut startup.startup_info,
            &mut process,
        )
    };
    if created == FALSE {
        return Err(io::Error::last_os_error());
    }

    let process_handle = OwnedHandle(process.process);
    let thread_handle = OwnedHandle(process.thread);
    let raw_job = unsafe { CreateJobObjectW(null_mut(), null()) };
    if raw_job.is_null() {
        let error = io::Error::last_os_error();
        unsafe {
            TerminateProcess(process_handle.0, 126);
        }
        return Err(error);
    }
    let _job_handle = OwnedHandle(raw_job);
    let mut job_limits: JobObjectExtendedLimitInformation = unsafe { zeroed() };
    job_limits.basic_limit_information.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if unsafe {
        SetInformationJobObject(
            raw_job,
            JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
            (&mut job_limits as *mut JobObjectExtendedLimitInformation).cast::<c_void>(),
            size_of::<JobObjectExtendedLimitInformation>() as Dword,
        )
    } == FALSE
    {
        let error = io::Error::last_os_error();
        unsafe {
            TerminateProcess(process_handle.0, 126);
        }
        return Err(error);
    }
    if unsafe { AssignProcessToJobObject(raw_job, process_handle.0) } == FALSE {
        let error = io::Error::last_os_error();
        unsafe {
            TerminateProcess(process_handle.0, 126);
        }
        return Err(error);
    }
    if unsafe { ResumeThread(thread_handle.0) } == Dword::MAX {
        let error = io::Error::last_os_error();
        unsafe {
            TerminateProcess(process_handle.0, 126);
        }
        return Err(error);
    }
    if unsafe { WaitForSingleObject(process_handle.0, INFINITE) } == WAIT_FAILED {
        return Err(io::Error::last_os_error());
    }
    let mut exit_code = 1u32;
    if unsafe { GetExitCodeProcess(process_handle.0, &mut exit_code) } == FALSE {
        return Err(io::Error::last_os_error());
    }
    Ok(exit_code)
}

fn main() {
    let mut arguments = env::args_os().skip(1);
    if arguments.next().as_deref() != Some(OsStr::new("--")) {
        eprintln!("atlasmind-acp-private-desktop: expected -- before the ACP command");
        std::process::exit(125);
    }

    match launch(arguments.collect()) {
        Ok(code) => std::process::exit(code as i32),
        Err(error) => {
            eprintln!(
                "atlasmind-acp-private-desktop: Windows could not start the ACP agent on its private desktop: {error}"
            );
            std::process::exit(126);
        }
    }
}
