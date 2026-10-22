//! A progress sink vetoes any delete that Windows would perform outside the Recycle Bin.
use std::{os::windows::ffi::OsStrExt, path::Path, sync::{Arc, Mutex}};
use windows::{core::{implement, Error, HRESULT, PCWSTR}, Win32::{Foundation::E_ABORT, System::Com::*, UI::Shell::*}};

#[implement(IFileOperationProgressSink)]
struct RecycleOnly { failure: Arc<Mutex<Option<HRESULT>>> }
#[allow(non_snake_case)]
impl IFileOperationProgressSink_Impl for RecycleOnly_Impl {
    fn StartOperations(&self) -> windows::core::Result<()> { Ok(()) }
    fn FinishOperations(&self, _hrresult: windows::core::HRESULT) -> windows::core::Result<()> { if _hrresult.is_err() { *self.failure.lock().map_err(|_| Error::from_hresult(E_ABORT))? = Some(_hrresult); } Ok(()) }
    fn PreRenameItem(&self, _dwflags: u32, _psiitem: windows::core::Ref<IShellItem>, _psznewname: &windows::core::PCWSTR) -> windows::core::Result<()> { Ok(()) }
    fn PostRenameItem(&self, _dwflags: u32, _psiitem: windows::core::Ref<IShellItem>, _psznewname: &windows::core::PCWSTR, _hrrename: windows::core::HRESULT, _psinewlycreated: windows::core::Ref<IShellItem>) -> windows::core::Result<()> { Ok(()) }
    fn PreMoveItem(&self, _dwflags: u32, _psiitem: windows::core::Ref<IShellItem>, _psidestinationfolder: windows::core::Ref<IShellItem>, _psznewname: &windows::core::PCWSTR) -> windows::core::Result<()> { Ok(()) }
    fn PostMoveItem(&self, _dwflags: u32, _psiitem: windows::core::Ref<IShellItem>, _psidestinationfolder: windows::core::Ref<IShellItem>, _psznewname: &windows::core::PCWSTR, _hrmove: windows::core::HRESULT, _psinewlycreated: windows::core::Ref<IShellItem>) -> windows::core::Result<()> { Ok(()) }
    fn PreCopyItem(&self, _dwflags: u32, _psiitem: windows::core::Ref<IShellItem>, _psidestinationfolder: windows::core::Ref<IShellItem>, _psznewname: &windows::core::PCWSTR) -> windows::core::Result<()> { Ok(()) }
    fn PostCopyItem(&self, _dwflags: u32, _psiitem: windows::core::Ref<IShellItem>, _psidestinationfolder: windows::core::Ref<IShellItem>, _psznewname: &windows::core::PCWSTR, _hrcopy: windows::core::HRESULT, _psinewlycreated: windows::core::Ref<IShellItem>) -> windows::core::Result<()> { Ok(()) }
    fn PreDeleteItem(&self, _dwflags: u32, _psiitem: windows::core::Ref<IShellItem>) -> windows::core::Result<()> { if _dwflags & TSF_DELETE_RECYCLE_IF_POSSIBLE.0 as u32 == 0 { Err(Error::from_hresult(E_ABORT)) } else { Ok(()) } }
    fn PostDeleteItem(&self, _dwflags: u32, _psiitem: windows::core::Ref<IShellItem>, _hrdelete: windows::core::HRESULT, _psinewlycreated: windows::core::Ref<IShellItem>) -> windows::core::Result<()> { if _hrdelete.is_err() { *self.failure.lock().map_err(|_| Error::from_hresult(E_ABORT))? = Some(_hrdelete); } Ok(()) }
    fn PreNewItem(&self, _dwflags: u32, _psidestinationfolder: windows::core::Ref<IShellItem>, _psznewname: &windows::core::PCWSTR) -> windows::core::Result<()> { Ok(()) }
    fn PostNewItem(&self, _dwflags: u32, _psidestinationfolder: windows::core::Ref<IShellItem>, _psznewname: &windows::core::PCWSTR, _psztemplatename: &windows::core::PCWSTR, _dwfileattributes: u32, _hrnew: windows::core::HRESULT, _psinewitem: windows::core::Ref<IShellItem>) -> windows::core::Result<()> { Ok(()) }
    fn UpdateProgress(&self, _iworktotal: u32, _iworksofar: u32) -> windows::core::Result<()> { Ok(()) }
    fn ResetTimer(&self) -> windows::core::Result<()> { Ok(()) }
    fn PauseTimer(&self) -> windows::core::Result<()> { Ok(()) }
    fn ResumeTimer(&self) -> windows::core::Result<()> { Ok(()) }
}

pub fn recycle(path: &Path) -> Result<(), String> {
    let path = path.to_path_buf();
    // A fresh apartment avoids COM apartment-mode conflicts with Tauri's worker pool.
    std::thread::spawn(move || -> Result<(), String> {
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().map_err(|e| e.to_string())?;
            struct Apartment;
            impl Drop for Apartment { fn drop(&mut self) { unsafe { CoUninitialize(); } } }
            let _apartment = Apartment;
            let run = || -> windows::core::Result<()> {
                let operation: IFileOperation = CoCreateInstance(&FileOperation, None, CLSCTX_INPROC_SERVER)?;
                operation.SetOperationFlags(FOF_NO_UI | FOF_ALLOWUNDO | FOF_WANTNUKEWARNING | FOFX_RECYCLEONDELETE | FOFX_EARLYFAILURE)?;
                let text = path.to_string_lossy();
                let shell_path = if let Some(rest) = text.strip_prefix(r"\\?\UNC\") { format!(r"\\{rest}") } else { text.strip_prefix(r"\\?\").unwrap_or(&text).to_string() };
                let wide: Vec<u16> = std::ffi::OsStr::new(&shell_path).encode_wide().chain(Some(0)).collect();
                let item: IShellItem = SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None)?;
                let failure = Arc::new(Mutex::new(None));
                let sink: IFileOperationProgressSink = RecycleOnly { failure: failure.clone() }.into();
                operation.DeleteItem(&item, &sink)?;
                operation.PerformOperations()?;
                if operation.GetAnyOperationsAborted()?.as_bool() { return Err(Error::from_hresult(E_ABORT)); }
                if let Some(code) = *failure.lock().map_err(|_| Error::from_hresult(E_ABORT))? { return Err(Error::from_hresult(code)); }
                if path.exists() { return Err(Error::from_hresult(E_ABORT)); }
                Ok(())
            };
            run().map_err(|e| e.to_string())
        }
    }).join().map_err(|_| "The Windows recycle operation stopped unexpectedly.".to_string())?
}
