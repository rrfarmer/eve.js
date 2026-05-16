from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence


MACOS_TOOLS_DIR = Path(__file__).resolve().parent
DEFAULT_MANIFEST_PATH = MACOS_TOOLS_DIR / "blue-so.patch.json"

CPU_TYPE_X86_64 = 0x01000007
CPU_TYPE_ARM64 = 0x0100000C

FAT_MAGIC = 0xCAFEBABE
FAT_MAGIC_64 = 0xCAFEBABF
MH_MAGIC = 0xFEEDFACE
MH_MAGIC_64 = 0xFEEDFACF
LC_SEGMENT = 0x1
LC_SEGMENT_64 = 0x19

CPU_TYPE_NAMES = {
    CPU_TYPE_X86_64: "x86_64",
    CPU_TYPE_ARM64: "arm64",
}


class PatchError(Exception):
    """Base error for blue.so patching."""


class PatchValidationError(PatchError):
    """The selected file is not safe to patch."""


class PatchManifestIncompleteError(PatchError):
    """The exact source build is known, but the patch payload is not recorded yet."""


class AlreadyPatchedError(PatchValidationError):
    """The selected file already matches the target patch."""


@dataclass(frozen=True)
class FixedPatch:
    offset: int
    offset_hex: str
    description: str
    before: bytes
    after: bytes
    allow_mismatched_before: bool
    arch: str | None = None


@dataclass(frozen=True)
class SliceManifest:
    arch: str
    size: int
    sha256: str
    offset: int | None = None
    align: int | None = None


@dataclass(frozen=True)
class MachOSliceInfo:
    arch: str
    offset: int
    size: int
    align: int | None
    sha256: str


@dataclass(frozen=True)
class MachOSegmentInfo:
    name: str
    vmaddr: int
    vmsize: int
    fileoff: int
    filesize: int


@dataclass(frozen=True)
class RuntimeSliceInfo:
    arch: str
    offset: int
    size: int
    align: int | None
    sha256: str
    base_vmaddr: int
    segments: tuple[MachOSegmentInfo, ...]


@dataclass(frozen=True)
class PatchManifest:
    name: str
    description: str
    build: str | None
    release_stage: str | None
    source_filename: str
    source_size: int
    source_sha256: str
    source_slices: tuple[SliceManifest, ...]
    target_filename: str | None
    target_size: int | None
    target_sha256: str | None
    target_slices: tuple[SliceManifest, ...]
    patches: tuple[FixedPatch, ...]
    patch_payload_ready: bool
    notes: str | None
    path: Path

    @property
    def target_hash_defined(self) -> bool:
        return (
            self.target_filename is not None
            and self.target_size is not None
            and self.target_sha256 is not None
        )

    @property
    def target_defined(self) -> bool:
        return self.target_hash_defined or bool(self.target_slices)


@dataclass(frozen=True)
class RuntimePatch:
    arch: str
    offset: int
    rva: int
    offset_hex: str
    rva_hex: str
    description: str
    before: bytes
    after: bytes
    allow_mismatched_before: bool


@dataclass(frozen=True)
class RuntimePatchPlan:
    input_path: Path
    manifest: PatchManifest
    detected_slices: tuple[MachOSliceInfo, ...]
    runtime_slices: tuple[RuntimeSliceInfo, ...]
    patches: tuple[RuntimePatch, ...]


@dataclass(frozen=True)
class InspectionResult:
    path: Path
    exists: bool
    size: int | None
    sha256: str | None
    detected_slices: tuple[MachOSliceInfo, ...]
    state: str
    summary: str
    action: str
    manifest: PatchManifest

    @property
    def can_patch(self) -> bool:
        return self.state in {"patchable_original", "patchable_variant"}


@dataclass(frozen=True)
class PatchResult:
    input_path: Path
    output_path: Path
    backup_path: Path | None
    backup_created: bool
    sha256: str
    size: int
    detected_slices: tuple[MachOSliceInfo, ...]
    manifest: PatchManifest
    used_relaxed_validation: bool


def _normalize_arch(arch: str | None) -> str | None:
    if arch is None:
        return None
    return str(arch).strip().lower()


def _arch_name_for_cpu_type(cputype: int) -> str:
    return CPU_TYPE_NAMES.get(cputype, f"cpu_0x{cputype:08x}")


def _load_slice_manifest(raw_slice: dict[str, Any]) -> SliceManifest:
    return SliceManifest(
        arch=_normalize_arch(raw_slice["arch"]) or "",
        offset=raw_slice.get("offset"),
        size=raw_slice["size"],
        align=raw_slice.get("align"),
        sha256=raw_slice["sha256"],
    )


def _load_patch(raw_patch: dict[str, Any]) -> FixedPatch:
    return FixedPatch(
        offset=raw_patch["offset"],
        offset_hex=raw_patch["offsetHex"],
        description=raw_patch["description"],
        before=bytes.fromhex(raw_patch["beforeHex"]),
        after=bytes.fromhex(raw_patch["afterHex"]),
        allow_mismatched_before=raw_patch.get("allowMismatchedBefore", False),
        arch=_normalize_arch(raw_patch.get("arch")),
    )


def load_manifest(manifest_path: str | Path = DEFAULT_MANIFEST_PATH) -> PatchManifest:
    manifest_file = Path(manifest_path).expanduser().resolve()
    raw = json.loads(manifest_file.read_text(encoding="utf-8"))

    source_raw = raw["source"]
    target_raw = raw.get("target") or {}

    return PatchManifest(
        name=raw["name"],
        description=raw["description"],
        build=str(raw["build"]) if raw.get("build") is not None else None,
        release_stage=(str(raw["releaseStage"]).strip().lower() if raw.get("releaseStage") is not None else None),
        source_filename=source_raw["filename"],
        source_size=source_raw["size"],
        source_sha256=source_raw["sha256"],
        source_slices=tuple(
            _load_slice_manifest(raw_slice)
            for raw_slice in source_raw.get("slices", [])
        ),
        target_filename=target_raw.get("filename"),
        target_size=target_raw.get("size"),
        target_sha256=target_raw.get("sha256"),
        target_slices=tuple(
            _load_slice_manifest(raw_slice)
            for raw_slice in target_raw.get("slices", [])
        ),
        patches=tuple(_load_patch(raw_patch) for raw_patch in raw.get("patches", [])),
        patch_payload_ready=raw.get(
            "patchPayloadReady",
            bool((target_raw or {}).get("sha256") and raw.get("patches")),
        ),
        notes=raw.get("notes"),
        path=manifest_file,
    )


def _stage_label(manifest: PatchManifest, *, include_article: bool = False) -> str:
    stage = (manifest.release_stage or "").strip().lower()
    if stage == "candidate":
        return "a candidate" if include_article else "candidate"
    return "the EvEJS" if include_article else "EvEJS"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: str | Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _read_file_bytes(path: Path) -> bytes:
    try:
        return path.read_bytes()
    except OSError as exc:
        raise PatchError(f"Failed to read {path}: {exc}") from exc


def _parse_fat_slices(source_bytes: bytes) -> tuple[MachOSliceInfo, ...]:
    magic = struct.unpack_from(">I", source_bytes, 0)[0]
    if magic == FAT_MAGIC:
        nfat_arch = struct.unpack_from(">I", source_bytes, 4)[0]
        offset = 8
        entry_size = 20
        slices = []
        for _ in range(nfat_arch):
            cputype, _cpusubtype, slice_offset, slice_size, align_power = struct.unpack_from(
                ">IIIII",
                source_bytes,
                offset,
            )
            slice_bytes = source_bytes[slice_offset : slice_offset + slice_size]
            slices.append(
                MachOSliceInfo(
                    arch=_arch_name_for_cpu_type(cputype),
                    offset=slice_offset,
                    size=slice_size,
                    align=1 << align_power,
                    sha256=sha256_bytes(slice_bytes),
                )
            )
            offset += entry_size
        return tuple(slices)

    if magic == FAT_MAGIC_64:
        nfat_arch = struct.unpack_from(">I", source_bytes, 4)[0]
        offset = 8
        entry_size = 32
        slices = []
        for _ in range(nfat_arch):
            cputype, _cpusubtype, slice_offset, slice_size, align_power, _reserved = struct.unpack_from(
                ">IIQQII",
                source_bytes,
                offset,
            )
            slice_bytes = source_bytes[slice_offset : slice_offset + slice_size]
            slices.append(
                MachOSliceInfo(
                    arch=_arch_name_for_cpu_type(cputype),
                    offset=int(slice_offset),
                    size=int(slice_size),
                    align=1 << align_power,
                    sha256=sha256_bytes(slice_bytes),
                )
            )
            offset += entry_size
        return tuple(slices)

    return ()


def _parse_thin_slice(source_bytes: bytes) -> tuple[MachOSliceInfo, ...]:
    if len(source_bytes) < 12:
        return ()

    magic_be = struct.unpack_from(">I", source_bytes, 0)[0]
    magic_le = struct.unpack_from("<I", source_bytes, 0)[0]

    if magic_be in {MH_MAGIC, MH_MAGIC_64}:
        endian = ">"
    elif magic_le in {MH_MAGIC, MH_MAGIC_64}:
        endian = "<"
    else:
        return ()

    cputype = struct.unpack_from(f"{endian}I", source_bytes, 4)[0]
    return (
        MachOSliceInfo(
            arch=_arch_name_for_cpu_type(cputype),
            offset=0,
            size=len(source_bytes),
            align=None,
            sha256=sha256_bytes(source_bytes),
        ),
    )


def detect_macho_slices(source_bytes: bytes) -> tuple[MachOSliceInfo, ...]:
    fat_slices = _parse_fat_slices(source_bytes)
    if fat_slices:
        return fat_slices
    return _parse_thin_slice(source_bytes)


def _detect_macho_endian_and_64bit(source_bytes: bytes) -> tuple[str, bool]:
    if len(source_bytes) < 4:
        raise PatchValidationError("Mach-O slice is too small to read the magic header.")

    magic_be = struct.unpack_from(">I", source_bytes, 0)[0]
    magic_le = struct.unpack_from("<I", source_bytes, 0)[0]

    if magic_be in {MH_MAGIC, MH_MAGIC_64}:
        return ">", magic_be == MH_MAGIC_64
    if magic_le in {MH_MAGIC, MH_MAGIC_64}:
        return "<", magic_le == MH_MAGIC_64
    raise PatchValidationError("Unsupported Mach-O slice header.")


def _segment_name(raw_name: bytes) -> str:
    return raw_name.split(b"\x00", 1)[0].decode("ascii", errors="replace")


def _parse_runtime_slice(
    source_bytes: bytes,
    *,
    slice_offset: int,
    align: int | None,
) -> RuntimeSliceInfo:
    endian, is_64 = _detect_macho_endian_and_64bit(source_bytes)
    header_size = 32 if is_64 else 28

    if len(source_bytes) < header_size:
        raise PatchValidationError("Mach-O slice is truncated before the main header completes.")

    cputype = struct.unpack_from(f"{endian}I", source_bytes, 4)[0]
    ncmds = struct.unpack_from(f"{endian}I", source_bytes, 16)[0]
    offset = header_size
    segments: list[MachOSegmentInfo] = []

    for _ in range(ncmds):
        if offset + 8 > len(source_bytes):
            raise PatchValidationError("Mach-O load command table is truncated.")

        cmd, cmdsize = struct.unpack_from(f"{endian}II", source_bytes, offset)
        if cmdsize < 8 or offset + cmdsize > len(source_bytes):
            raise PatchValidationError("Mach-O load command size is invalid.")

        if is_64 and cmd == LC_SEGMENT_64:
            if cmdsize < 72:
                raise PatchValidationError("LC_SEGMENT_64 command is truncated.")
            (
                segname_raw,
                vmaddr,
                vmsize,
                fileoff,
                filesize,
                _maxprot,
                _initprot,
                _nsects,
                _flags,
            ) = struct.unpack_from(f"{endian}16sQQQQiiII", source_bytes, offset + 8)
            segments.append(
                MachOSegmentInfo(
                    name=_segment_name(segname_raw),
                    vmaddr=int(vmaddr),
                    vmsize=int(vmsize),
                    fileoff=int(fileoff),
                    filesize=int(filesize),
                )
            )
        elif not is_64 and cmd == LC_SEGMENT:
            if cmdsize < 56:
                raise PatchValidationError("LC_SEGMENT command is truncated.")
            (
                segname_raw,
                vmaddr,
                vmsize,
                fileoff,
                filesize,
                _maxprot,
                _initprot,
                _nsects,
                _flags,
            ) = struct.unpack_from(f"{endian}16sIIIIiiII", source_bytes, offset + 8)
            segments.append(
                MachOSegmentInfo(
                    name=_segment_name(segname_raw),
                    vmaddr=int(vmaddr),
                    vmsize=int(vmsize),
                    fileoff=int(fileoff),
                    filesize=int(filesize),
                )
            )

        offset += cmdsize

    if not segments:
        raise PatchValidationError("Mach-O slice does not expose any segment commands.")

    file_backed_segments = tuple(segment for segment in segments if segment.filesize > 0)
    if not file_backed_segments:
        raise PatchValidationError("Mach-O slice has no file-backed segments.")

    return RuntimeSliceInfo(
        arch=_arch_name_for_cpu_type(cputype),
        offset=slice_offset,
        size=len(source_bytes),
        align=align,
        sha256=sha256_bytes(source_bytes),
        base_vmaddr=min(segment.vmaddr for segment in file_backed_segments),
        segments=tuple(segments),
    )


def detect_runtime_slices(source_bytes: bytes) -> tuple[RuntimeSliceInfo, ...]:
    magic = struct.unpack_from(">I", source_bytes, 0)[0]
    if magic == FAT_MAGIC:
        nfat_arch = struct.unpack_from(">I", source_bytes, 4)[0]
        offset = 8
        entry_size = 20
        slices = []
        for _ in range(nfat_arch):
            cputype, _cpusubtype, slice_offset, slice_size, align_power = struct.unpack_from(
                ">IIIII",
                source_bytes,
                offset,
            )
            slice_bytes = source_bytes[slice_offset : slice_offset + slice_size]
            parsed_slice = _parse_runtime_slice(
                slice_bytes,
                slice_offset=slice_offset,
                align=1 << align_power,
            )
            if parsed_slice.arch != _arch_name_for_cpu_type(cputype):
                raise PatchValidationError("Mach-O slice architecture does not match the fat header.")
            slices.append(parsed_slice)
            offset += entry_size
        return tuple(slices)

    if magic == FAT_MAGIC_64:
        nfat_arch = struct.unpack_from(">I", source_bytes, 4)[0]
        offset = 8
        entry_size = 32
        slices = []
        for _ in range(nfat_arch):
            cputype, _cpusubtype, slice_offset, slice_size, align_power, _reserved = struct.unpack_from(
                ">IIQQII",
                source_bytes,
                offset,
            )
            slice_bytes = source_bytes[slice_offset : slice_offset + slice_size]
            parsed_slice = _parse_runtime_slice(
                slice_bytes,
                slice_offset=int(slice_offset),
                align=1 << align_power,
            )
            if parsed_slice.arch != _arch_name_for_cpu_type(cputype):
                raise PatchValidationError("Mach-O slice architecture does not match the fat header.")
            slices.append(parsed_slice)
            offset += entry_size
        return tuple(slices)

    return (_parse_runtime_slice(source_bytes, slice_offset=0, align=None),)


def _slice_map(
    slices: Sequence[SliceManifest | MachOSliceInfo | RuntimeSliceInfo],
) -> dict[str, SliceManifest | MachOSliceInfo | RuntimeSliceInfo]:
    mapping: dict[str, SliceManifest | MachOSliceInfo | RuntimeSliceInfo] = {}
    for slice_info in slices:
        mapping[_normalize_arch(slice_info.arch) or ""] = slice_info
    return mapping


def _slice_layout_matches_manifest(
    expected_slices: Sequence[SliceManifest],
    detected_slices: Sequence[MachOSliceInfo],
) -> bool:
    if not expected_slices:
        return True
    if len(expected_slices) != len(detected_slices):
        return False

    detected_by_arch = _slice_map(detected_slices)
    for expected in expected_slices:
        actual = detected_by_arch.get(expected.arch)
        if actual is None:
            return False
        if expected.size != actual.size:
            return False
        if expected.sha256 != actual.sha256:
            return False
    return True


def inspect_blue_so(path: str | Path, manifest: PatchManifest | None = None) -> InspectionResult:
    manifest = manifest or load_manifest()
    candidate = Path(path).expanduser().resolve()

    if not candidate.exists():
        return InspectionResult(
            path=candidate,
            exists=False,
            size=None,
            sha256=None,
            detected_slices=(),
            state="missing",
            summary="File not found.",
            action="Choose blue.so from the copied client's build/bin64 folder.",
            manifest=manifest,
        )

    if not candidate.is_file():
        return InspectionResult(
            path=candidate,
            exists=False,
            size=None,
            sha256=None,
            detected_slices=(),
            state="missing",
            summary="That path is not a file.",
            action="Choose the actual blue.so file, not a folder.",
            manifest=manifest,
        )

    source_bytes = _read_file_bytes(candidate)
    size = len(source_bytes)
    file_hash = sha256_bytes(source_bytes)
    detected_slices = detect_macho_slices(source_bytes)
    slices_match_manifest = _slice_layout_matches_manifest(
        manifest.source_slices,
        detected_slices,
    )

    if (
        manifest.target_hash_defined
        and size == manifest.target_size
        and file_hash == manifest.target_sha256
    ):
        stage_label = _stage_label(manifest)
        return InspectionResult(
            path=candidate,
            exists=True,
            size=size,
            sha256=file_hash,
            detected_slices=detected_slices,
            state="already_patched",
            summary=f"This file already matches the recorded {stage_label} patched blue.so.",
            action="No patch is needed.",
            manifest=manifest,
        )

    if manifest.patch_payload_ready and manifest.patches and _patch_bytes_match(
        source_bytes,
        detected_slices,
        manifest.patches,
        expect_after=True,
    ):
        stage_label = _stage_label(manifest)
        return InspectionResult(
            path=candidate,
            exists=True,
            size=size,
            sha256=file_hash,
            detected_slices=detected_slices,
            state="already_patched",
            summary=(
                f"This file already contains the recorded {stage_label} patch bytes, "
                "but the overall Mach-O hash differs from the manifest target."
            ),
            action="No patch is needed. This usually means the copied client was re-signed after patching.",
            manifest=manifest,
        )

    if size == manifest.source_size and file_hash == manifest.source_sha256:
        if manifest.patch_payload_ready and manifest.target_defined and manifest.patches:
            stage_label = _stage_label(manifest, include_article=True)
            return InspectionResult(
                path=candidate,
                exists=True,
                size=size,
                sha256=file_hash,
                detected_slices=detected_slices,
                state="patchable_original",
                summary="Exact original build detected. Safe to patch.",
                action=f"Ready to patch to {stage_label} Mac blue.so build.",
                manifest=manifest,
            )

        summary = "Exact supported source build detected, but the EvEJS blue.so patch payload is not recorded yet."
        action = "Use this exact build for Mac reverse-engineering or update blue-so.patch.json with the native patch bytes."
        if manifest.notes:
            action = f"{action} Note: {manifest.notes}"
        return InspectionResult(
            path=candidate,
            exists=True,
            size=size,
            sha256=file_hash,
            detected_slices=detected_slices,
            state="supported_source",
            summary=summary,
            action=action,
            manifest=manifest,
        )

    if size == manifest.source_size and slices_match_manifest:
        summary = "Per-architecture slice hashes match the recorded source build, but the overall fat binary hash differs."
        action = "This is useful for Mac reverse-engineering, but patching should stay disabled until the target slice hashes are recorded."
        if manifest.patch_payload_ready and manifest.target_defined and manifest.patches:
            action = "Use --attempt-anyway only after recording a target manifest that validates the patched Mac slices."
        return InspectionResult(
            path=candidate,
            exists=True,
            size=size,
            sha256=file_hash,
            detected_slices=detected_slices,
            state="supported_source_variant",
            summary=summary,
            action=action,
            manifest=manifest,
        )

    if size == manifest.source_size and manifest.patch_payload_ready and manifest.target_defined and manifest.patches:
        try:
            _apply_patch_bytes(source_bytes, manifest, allow_relaxed_variant=True)
        except PatchError:
            pass
        else:
            return InspectionResult(
                path=candidate,
                exists=True,
                size=size,
                sha256=file_hash,
                detected_slices=detected_slices,
                state="patchable_variant",
                summary=(
                    "This blue.so differs from the recorded source hash, but a relaxed dry run "
                    "still reaches the exact EvEJS patched target."
                ),
                action="Use --attempt-anyway to patch and verify against the known-good target hash.",
                manifest=manifest,
            )

    if size == manifest.source_size:
        summary = "This looks like a blue.so from the right size family, but not the exact supported build."
    else:
        summary = "This file does not match the supported blue.so size for the current Mac patch manifest."

    return InspectionResult(
        path=candidate,
        exists=True,
        size=size,
        sha256=file_hash,
        detected_slices=detected_slices,
        state="unknown",
        summary=summary,
        action="Do not patch this file unless you add manifest support for its exact build.",
        manifest=manifest,
    )


def _resolve_patch_offset(
    patch: FixedPatch,
    detected_slices: Sequence[MachOSliceInfo],
) -> int:
    if patch.arch is None:
        return patch.offset

    slice_info = _slice_map(detected_slices).get(patch.arch)
    if slice_info is None:
        raise PatchValidationError(
            f"Patch {patch.offset_hex} targets slice '{patch.arch}', but that architecture was not found in this Mach-O binary."
        )

    assert isinstance(slice_info, MachOSliceInfo)
    if patch.offset < 0 or patch.offset + len(patch.before) > slice_info.size:
        raise PatchValidationError(
            f"Patch {patch.offset_hex} is out of bounds for slice '{patch.arch}' (size {slice_info.size})."
        )

    return slice_info.offset + patch.offset


def _slice_hashes_match_expected(
    expected_slices: Sequence[SliceManifest],
    detected_slices: Sequence[MachOSliceInfo],
) -> bool:
    if not expected_slices:
        return True

    detected_by_arch = _slice_map(detected_slices)
    for expected in expected_slices:
        actual = detected_by_arch.get(expected.arch)
        if actual is None:
            return False
        assert isinstance(actual, MachOSliceInfo)
        if expected.size != actual.size or expected.sha256 != actual.sha256:
            return False
    return True


def _patch_bytes_match(
    source_bytes: bytes,
    detected_slices: Sequence[MachOSliceInfo],
    patches: Sequence[FixedPatch],
    *,
    expect_after: bool,
) -> bool:
    expected_attr = "after" if expect_after else "before"
    try:
        for patch in patches:
            absolute_offset = _resolve_patch_offset(patch, detected_slices)
            expected = getattr(patch, expected_attr)
            current = source_bytes[absolute_offset : absolute_offset + len(expected)]
            if current != expected:
                return False
    except PatchValidationError:
        return False
    return True


def _resolve_runtime_patch_rva(
    patch: FixedPatch,
    runtime_slices: Sequence[RuntimeSliceInfo],
) -> tuple[str, int]:
    if patch.arch is None:
        if len(runtime_slices) != 1:
            raise PatchValidationError(
                f"Patch {patch.offset_hex} has no architecture tag, but this Mach-O has multiple slices."
            )
        target_slice = runtime_slices[0]
    else:
        slice_info = _slice_map(runtime_slices).get(patch.arch)
        if slice_info is None:
            raise PatchValidationError(
                f"Patch {patch.offset_hex} targets slice '{patch.arch}', but that architecture was not found in this Mach-O binary."
            )
        assert isinstance(slice_info, RuntimeSliceInfo)
        target_slice = slice_info

    if patch.offset < 0 or patch.offset + len(patch.before) > target_slice.size:
        raise PatchValidationError(
            f"Patch {patch.offset_hex} is out of bounds for slice '{target_slice.arch}' (size {target_slice.size})."
        )

    for segment in target_slice.segments:
        if segment.filesize <= 0:
            continue
        segment_end = segment.fileoff + segment.filesize
        patch_end = patch.offset + len(patch.before)
        if patch.offset >= segment.fileoff and patch_end <= segment_end:
            vmaddr = segment.vmaddr + (patch.offset - segment.fileoff)
            rva = int(vmaddr - target_slice.base_vmaddr)
            return target_slice.arch, rva

    raise PatchValidationError(
        f"Patch {patch.offset_hex} is not covered by a file-backed segment in slice '{target_slice.arch}'."
    )


def apply_patch_bytes(source_bytes: bytes, manifest: PatchManifest | None = None) -> bytes:
    return _apply_patch_bytes(source_bytes, manifest, allow_relaxed_variant=False)


def _apply_patch_bytes(
    source_bytes: bytes,
    manifest: PatchManifest | None = None,
    *,
    allow_relaxed_variant: bool = False,
) -> bytes:
    manifest = manifest or load_manifest()

    if not manifest.patch_payload_ready or not manifest.target_defined or not manifest.patches:
        raise PatchManifestIncompleteError(
            "The exact source blue.so build is recorded, but the patch payload is not recorded yet."
        )

    source_hash = sha256_bytes(source_bytes)
    detected_slices = detect_macho_slices(source_bytes)
    is_exact_source = (
        len(source_bytes) == manifest.source_size
        and source_hash == manifest.source_sha256
    )

    if (
        manifest.target_hash_defined
        and len(source_bytes) == manifest.target_size
        and source_hash == manifest.target_sha256
    ):
        raise AlreadyPatchedError("This blue.so is already patched.")
    if len(source_bytes) != manifest.source_size:
        raise PatchValidationError(
            "This blue.so does not match the supported original size and will not be patched."
        )
    if not is_exact_source and not allow_relaxed_variant:
        raise PatchValidationError(
            "This blue.so does not match the exact supported original build and will not be patched."
        )

    patched = bytearray(source_bytes)

    for patch in manifest.patches:
        absolute_offset = _resolve_patch_offset(patch, detected_slices)
        current = bytes(patched[absolute_offset : absolute_offset + len(patch.before)])
        if current != patch.before and not patch.allow_mismatched_before:
            arch_prefix = f"[{patch.arch}] " if patch.arch else ""
            raise PatchValidationError(
                f"{arch_prefix}Unexpected bytes at {patch.offset_hex}. Expected {patch.before.hex()}, got {current.hex()}."
            )
        patched[absolute_offset : absolute_offset + len(patch.after)] = patch.after

    final_bytes = bytes(patched)

    if manifest.target_hash_defined:
        if len(final_bytes) != manifest.target_size:
            raise PatchError(
                f"Patched output size mismatch. Expected {manifest.target_size}, got {len(final_bytes)}."
            )

        final_hash = sha256_bytes(final_bytes)
        if final_hash != manifest.target_sha256:
            raise PatchError("Patched output SHA-256 does not match the target manifest hash.")

    if manifest.target_slices:
        final_slices = detect_macho_slices(final_bytes)
        if not _slice_hashes_match_expected(manifest.target_slices, final_slices):
            raise PatchError("Patched output slice hashes do not match the target manifest.")

    return final_bytes


def _default_output_path(input_path: Path) -> Path:
    return input_path.with_name(f"{input_path.stem}.patched{input_path.suffix}")


def _find_client_root_for_eve_file(path: Path) -> Path | None:
    current = path.parent
    while current != current.parent:
        if current.name == "SharedCache":
            return current.parent
        current = current.parent
    return None


def _default_backup_path(input_path: Path, backup_suffix: str) -> Path:
    client_root = _find_client_root_for_eve_file(input_path)
    if client_root is not None:
        try:
            relative_path = input_path.relative_to(client_root)
        except ValueError:
            relative_path = None
        if relative_path is not None:
            backup_root = client_root / ".evejs-backups"
            return backup_root / relative_path.parent / f"{relative_path.name}{backup_suffix}"
    return input_path.with_name(f"{input_path.name}{backup_suffix}")


def _write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f"{path.name}.tmp")
    try:
        temp_path.write_bytes(data)
        os.replace(temp_path, path)
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except OSError:
                pass


def apply_patch(
    input_path: str | Path,
    *,
    output_path: str | Path | None = None,
    in_place: bool = False,
    backup_suffix: str = ".original",
    manifest: PatchManifest | None = None,
    force: bool = False,
    allow_relaxed_variant: bool = False,
) -> PatchResult:
    manifest = manifest or load_manifest()
    candidate = Path(input_path).expanduser().resolve()
    inspection = inspect_blue_so(candidate, manifest)

    if inspection.state == "already_patched":
        raise AlreadyPatchedError("This blue.so already matches the EvEJS patched build.")
    if inspection.state in {"supported_source", "supported_source_variant"}:
        raise PatchManifestIncompleteError(
            "This blue.so source build is recorded, but the native patch payload is not recorded yet."
        )
    if not inspection.can_patch:
        raise PatchValidationError(inspection.summary)
    if inspection.state == "patchable_variant" and not allow_relaxed_variant:
        raise PatchValidationError(
            "This blue.so needs --attempt-anyway because its source hash differs from the recorded build."
        )

    source_bytes = _read_file_bytes(candidate)
    patched_bytes = _apply_patch_bytes(
        source_bytes,
        manifest,
        allow_relaxed_variant=allow_relaxed_variant,
    )

    backup_path: Path | None = None
    backup_created = False

    if in_place:
        output = candidate
        backup_path = _default_backup_path(candidate, backup_suffix)
        if not backup_path.exists():
            backup_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(candidate, backup_path)
            backup_created = True
    else:
        output = Path(output_path).expanduser().resolve() if output_path else _default_output_path(candidate)
        if output.exists() and not force:
            raise PatchValidationError(
                f"Output file already exists: {output}. Choose another path or enable overwrite."
            )

    _write_atomic(output, patched_bytes)

    return PatchResult(
        input_path=candidate,
        output_path=output,
        backup_path=backup_path,
        backup_created=backup_created,
        sha256=sha256_bytes(patched_bytes),
        size=len(patched_bytes),
        detected_slices=detect_macho_slices(patched_bytes),
        manifest=manifest,
        used_relaxed_validation=allow_relaxed_variant,
    )


def _format_slice_line(slice_info: SliceManifest | MachOSliceInfo) -> str:
    align_value = f" align={slice_info.align}" if slice_info.align is not None else ""
    offset_value = f" offset={slice_info.offset}" if slice_info.offset is not None else ""
    return (
        f"  - {slice_info.arch}:{offset_value} size={slice_info.size}{align_value} "
        f"sha256={slice_info.sha256}"
    )


def format_inspection(result: InspectionResult) -> str:
    lines = [
        f"Path:    {result.path}",
        f"State:   {result.state}",
        f"Summary: {result.summary}",
        f"Action:  {result.action}",
    ]
    if result.manifest.build is not None:
        lines.append(f"Manifest build: {result.manifest.build}")
    if result.size is not None:
        lines.append(f"Size:    {result.size}")
    if result.sha256 is not None:
        lines.append(f"SHA-256: {result.sha256}")
    if result.detected_slices:
        lines.append("Slices:")
        lines.extend(_format_slice_line(slice_info) for slice_info in result.detected_slices)
    return "\n".join(lines)


def format_patch_result(result: PatchResult) -> str:
    stage = result.manifest.release_stage
    lines = [
        f"Input:   {result.input_path}",
        f"Output:  {result.output_path}",
        f"Size:    {result.size}",
        f"SHA-256: {result.sha256}",
    ]
    if result.manifest.build is not None:
        lines.append(f"Build:   {result.manifest.build}")
    if stage:
        lines.append(f"Stage:   {stage}")
    if result.detected_slices:
        lines.append("Slices:")
        lines.extend(_format_slice_line(slice_info) for slice_info in result.detected_slices)
    if result.used_relaxed_validation:
        lines.append("Mode:    relaxed compatibility")
    if result.backup_path is not None:
        status = "created" if result.backup_created else "already existed"
        lines.append(f"Backup:  {result.backup_path} ({status})")
    return "\n".join(lines)


def build_runtime_patch_plan(
    input_path: str | Path,
    manifest: PatchManifest | None = None,
) -> RuntimePatchPlan:
    manifest = manifest or load_manifest()

    if not manifest.patch_payload_ready or not manifest.patches:
        raise PatchManifestIncompleteError(
            "The exact source blue.so build is recorded, but the runtime patch payload is not recorded yet."
        )

    candidate = Path(input_path).expanduser().resolve()
    inspection = inspect_blue_so(candidate, manifest)
    if inspection.state == "already_patched":
        raise AlreadyPatchedError(
            "This blue.so already contains the recorded patch bytes. Runtime patching expects untouched source slices."
        )
    if inspection.state not in {"patchable_original", "supported_source_variant"}:
        raise PatchValidationError(
            "Runtime patching only supports the recorded unmodified source slices. "
            f"{inspection.summary}"
        )

    source_bytes = _read_file_bytes(candidate)
    detected_slices = detect_macho_slices(source_bytes)
    if not _slice_hashes_match_expected(manifest.source_slices, detected_slices):
        raise PatchValidationError(
            "This blue.so does not match the recorded source slice hashes for runtime patching."
        )

    runtime_slices = detect_runtime_slices(source_bytes)
    runtime_patches = []
    for patch in manifest.patches:
        arch, rva = _resolve_runtime_patch_rva(patch, runtime_slices)
        runtime_patches.append(
            RuntimePatch(
                arch=arch,
                offset=patch.offset,
                rva=rva,
                offset_hex=patch.offset_hex,
                rva_hex=f"0x{rva:08X}",
                description=patch.description,
                before=patch.before,
                after=patch.after,
                allow_mismatched_before=patch.allow_mismatched_before,
            )
        )

    return RuntimePatchPlan(
        input_path=candidate,
        manifest=manifest,
        detected_slices=detected_slices,
        runtime_slices=runtime_slices,
        patches=tuple(runtime_patches),
    )


def runtime_patch_plan_to_dict(plan: RuntimePatchPlan) -> dict[str, Any]:
    return {
        "input": str(plan.input_path),
        "build": plan.manifest.build,
        "manifest": str(plan.manifest.path),
        "slices": [
            {
                "arch": slice_info.arch,
                "offset": slice_info.offset,
                "size": slice_info.size,
                "align": slice_info.align,
                "sha256": slice_info.sha256,
                "baseVmaddr": slice_info.base_vmaddr,
                "baseVmaddrHex": f"0x{slice_info.base_vmaddr:016X}",
            }
            for slice_info in plan.runtime_slices
        ],
        "patches": [
            {
                "arch": patch.arch,
                "offset": patch.offset,
                "offsetHex": patch.offset_hex,
                "rva": patch.rva,
                "rvaHex": patch.rva_hex,
                "description": patch.description,
                "beforeHex": patch.before.hex(),
                "afterHex": patch.after.hex(),
                "allowMismatchedBefore": patch.allow_mismatched_before,
            }
            for patch in plan.patches
        ],
    }


def build_manifest_template(
    input_path: str | Path,
    *,
    build: str | None = None,
) -> dict[str, Any]:
    candidate = Path(input_path).expanduser().resolve()
    source_bytes = _read_file_bytes(candidate)
    detected_slices = detect_macho_slices(source_bytes)

    return {
        "name": candidate.name,
        "description": "Exact-build patch metadata for the macOS EvEJS copied-client flow.",
        "build": build,
        "releaseStage": "candidate",
        "source": {
            "filename": candidate.name,
            "size": len(source_bytes),
            "sha256": sha256_bytes(source_bytes),
            "slices": [
                {
                    "arch": slice_info.arch,
                    "offset": slice_info.offset,
                    "size": slice_info.size,
                    "align": slice_info.align,
                    "sha256": slice_info.sha256,
                }
                for slice_info in detected_slices
            ],
        },
        "target": None,
        "patchPayloadReady": False,
        "patches": [],
        "notes": "The copied local source client is the Mac patch target. Record per-slice patches when the native blue.so branch flip is identified.",
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Apply or inspect the EvEJS macOS blue.so patch.")
    parser.add_argument("--input", required=True, help="Path to the blue.so to inspect or patch.")
    parser.add_argument("--inspect", action="store_true", help="Inspect only; do not patch.")
    parser.add_argument(
        "--emit-template",
        action="store_true",
        help="Print a manifest template for this exact Mach-O binary and exit.",
    )
    parser.add_argument(
        "--build",
        help="Optional build value used by --emit-template.",
    )
    parser.add_argument(
        "--emit-runtime-plan",
        action="store_true",
        help="Print the runtime patch plan JSON for this exact Mach-O binary and exit.",
    )
    parser.add_argument("--output", help="Path for the patched file when not patching in place.")
    parser.add_argument("--in-place", action="store_true", help="Patch the selected file in place.")
    parser.add_argument(
        "--backup-suffix",
        default=".original",
        help="Backup suffix used for --in-place. For copied EVE clients, backups live under .evejs-backups outside EVE.app. Default: .original",
    )
    parser.add_argument("--manifest", default=str(DEFAULT_MANIFEST_PATH), help="Path to the patch manifest.")
    parser.add_argument("--force", action="store_true", help="Overwrite an existing output path.")
    parser.add_argument(
        "--attempt-anyway",
        action="store_true",
        help="Try a compatible hash variant and only succeed if the final output still matches the known target hash.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.emit_template:
        template = build_manifest_template(args.input, build=args.build)
        print(json.dumps(template, indent=2))
        return 0

    manifest = load_manifest(args.manifest)

    if args.emit_runtime_plan:
        plan = build_runtime_patch_plan(args.input, manifest)
        print(json.dumps(runtime_patch_plan_to_dict(plan), indent=2))
        return 0

    if args.inspect:
        result = inspect_blue_so(args.input, manifest)
        print(format_inspection(result))
        return 0

    result = apply_patch(
        args.input,
        output_path=args.output,
        in_place=args.in_place,
        backup_suffix=args.backup_suffix,
        manifest=manifest,
        force=args.force,
        allow_relaxed_variant=args.attempt_anyway,
    )
    print(format_patch_result(result))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except PatchError as exc:
        print(str(exc))
        raise SystemExit(1) from exc
