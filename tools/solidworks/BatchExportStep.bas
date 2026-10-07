Attribute VB_Name = "BatchExportStep"
Option Explicit
'
' BatchExportStep - converts every SOLIDWORKS part and assembly under a folder to STEP.
'
' Runs INSIDE SOLIDWORKS (it uses the SOLIDWORKS API), on a machine that has SOLIDWORKS installed.
' It is not part of 3D-Builder and 3D-Builder does not need it; it only saves you exporting by hand.
' How to install and what to check afterwards: tools/solidworks/README.md
'
' What it does
'   - asks for a folder; takes every *.sldprt and *.sldasm under it (sub folders too)
'   - writes <folder>\STEP\<same sub folders>\<name>.step   (the STEP folder itself is skipped)
'   - an assembly is opened read-only, its lightweight components are resolved, and it is exported
'     with the assembly structure the STEP options of SOLIDWORKS give (see the README: set them first)
'   - a part and an assembly with the same name in one folder: the part becomes <name>_part.step
'   - a file whose STEP is newer than it is skipped (delete the STEP folder to export everything again)
'   - writes <folder>\STEP\export-log.csv: one line per file, with the result and the seconds it took
'
' Only the active configuration of a part or assembly is exported.
' Keep this file plain ASCII: the VBA editor reads it in the system code page.

Private Const LOG_NAME As String = "export-log.csv"

Sub main()
    Dim swApp As SldWorks.SldWorks
    Set swApp = Application.SldWorks

    Dim root As String
    root = PickFolder("Folder with the SOLIDWORKS parts and assemblies to export to STEP")
    If Len(root) = 0 Then Exit Sub

    Dim fso As Object
    Set fso = CreateObject("Scripting.FileSystemObject")

    Dim outRoot As String
    outRoot = fso.BuildPath(root, "STEP")

    Dim files As Collection
    Set files = New Collection
    Collect fso, fso.GetFolder(root), outRoot, files

    If files.Count = 0 Then
        MsgBox "No .sldprt or .sldasm files found under " & root, vbInformation
        Exit Sub
    End If

    EnsureFolder fso, outRoot
    Dim logFile As Object
    Set logFile = fso.CreateTextFile(fso.BuildPath(outRoot, LOG_NAME), True, True)
    logFile.WriteLine "file,kind,result,message,seconds,step"

    Dim done As Long, skipped As Long, failed As Long
    Dim i As Long, src As String, isAsm As Boolean, dst As String, msg As String, t0 As Double, result As String
    For i = 1 To files.Count
        src = files(i)
        isAsm = (LCase$(fso.GetExtensionName(src)) = "sldasm")
        dst = StepPathFor(fso, root, outRoot, src, isAsm)
        EnsureFolder fso, fso.GetParentFolderName(dst)
        msg = ""
        t0 = Timer
        If fso.FileExists(dst) Then
            If FileDateTime(dst) >= FileDateTime(src) Then
                result = "skipped"
                msg = "the STEP is newer than the file"
                skipped = skipped + 1
            Else
                result = IIf(ExportOne(swApp, src, dst, isAsm, msg), "ok", "failed")
            End If
        Else
            result = IIf(ExportOne(swApp, src, dst, isAsm, msg), "ok", "failed")
        End If
        If result = "ok" Then done = done + 1
        If result = "failed" Then failed = failed + 1
        logFile.WriteLine Csv(src) & "," & IIf(isAsm, "assembly", "part") & "," & result & "," & Csv(msg) & "," & Format$(Timer - t0, "0.0") & "," & Csv(dst)
        swApp.SetStatusBarText "STEP export " & i & " / " & files.Count
    Next i
    logFile.Close

    MsgBox "Done: " & done & " exported, " & skipped & " skipped, " & failed & " failed." & vbCrLf & "Log: " & fso.BuildPath(outRoot, LOG_NAME), IIf(failed > 0, vbExclamation, vbInformation)
End Sub

' Opens one file read-only, exports it, closes it. False with a message when something goes wrong.
Private Function ExportOne(swApp As SldWorks.SldWorks, src As String, dst As String, isAsm As Boolean, ByRef msg As String) As Boolean
    Dim model As SldWorks.ModelDoc2
    Dim errs As Long, warns As Long
    Dim docType As Long
    docType = IIf(isAsm, swDocASSEMBLY, swDocPART)

    On Error GoTo Failed
    Set model = swApp.OpenDoc6(src, docType, swOpenDocOptions_Silent Or swOpenDocOptions_ReadOnly, "", errs, warns)
    If model Is Nothing Then
        msg = "could not open it (SOLIDWORKS error code " & errs & ")"
        Exit Function
    End If

    If isAsm Then
        Dim asm As SldWorks.AssemblyDoc
        Set asm = model
        asm.ResolveAllLightWeightComponents False
    End If

    Dim ok As Boolean
    ok = model.Extension.SaveAs(dst, swSaveAsCurrentVersion, swSaveAsOptions_Silent Or swSaveAsOptions_Copy, Nothing, errs, warns)
    If Not ok Then
        msg = "the export failed (SOLIDWORKS error code " & errs & ")"
    Else
        ExportOne = True
        If warns <> 0 Then msg = "exported with warning code " & warns
    End If
    swApp.CloseDoc model.GetTitle
    Exit Function

Failed:
    msg = "error " & Err.Number & ": " & Err.Description
    On Error Resume Next
    If Not model Is Nothing Then swApp.CloseDoc model.GetTitle
End Function

' Every .sldprt / .sldasm under `folder`, not in the output folder and not a ~$ lock file.
Private Sub Collect(fso As Object, folder As Object, outRoot As String, files As Collection)
    If LCase$(folder.Path) = LCase$(outRoot) Then Exit Sub
    Dim f As Object, ext As String
    For Each f In folder.Files
        If Left$(f.Name, 2) <> "~$" Then
            ext = LCase$(fso.GetExtensionName(f.Name))
            If ext = "sldprt" Or ext = "sldasm" Then files.Add f.Path
        End If
    Next f
    Dim sub_ As Object
    For Each sub_ In folder.SubFolders
        Collect fso, sub_, outRoot, files
    Next sub_
End Sub

' <outRoot>\<path of the file's folder below root>\<name>.step ; a part beside an assembly of the same name gets _part.
Private Function StepPathFor(fso As Object, root As String, outRoot As String, src As String, isAsm As Boolean) As String
    Dim folder As String, rel As String, base As String
    folder = fso.GetParentFolderName(src)
    rel = Mid$(folder, Len(root) + 1)
    base = fso.GetBaseName(src)
    If Not isAsm Then
        If fso.FileExists(fso.BuildPath(folder, base & ".sldasm")) Then base = base & "_part"
    End If
    StepPathFor = outRoot & rel & "\" & base & ".step"
End Function

Private Sub EnsureFolder(fso As Object, path As String)
    If Len(path) = 0 Or fso.FolderExists(path) Then Exit Sub
    EnsureFolder fso, fso.GetParentFolderName(path)
    fso.CreateFolder path
End Sub

Private Function PickFolder(prompt As String) As String
    Dim sh As Object, f As Object
    Set sh = CreateObject("Shell.Application")
    Set f = sh.BrowseForFolder(0, prompt, 0)
    If Not f Is Nothing Then PickFolder = f.Self.Path
End Function

Private Function Csv(s As String) As String
    Csv = """" & Replace(s, """", """""") & """"
End Function
