import pathlib
import sys

import pefile
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from capstone.x86 import X86_OP_IMM, X86_OP_MEM, X86_REG_RIP


TARGETS = {
    "plain_warp_parser": 0x180092830,
    "rich_warp_parser": 0x1800928F0,
    "set_max_speed_parser": 0x180092F20,
    "add_ball_parser": 0x180091CA0,
    "set_ball_massive_parser": 0x180091820,
    "plain_warp_handler": 0x1800425E0,
    "rich_warp_initializer": 0x180043140,
}


def get_function_bounds(pe, va):
    base = pe.OPTIONAL_HEADER.ImageBase
    for entry in pe.DIRECTORY_ENTRY_EXCEPTION:
        begin = base + entry.struct.BeginAddress
        end = base + entry.struct.EndAddress
        if begin <= va < end:
            return begin, end
    return None


def read_ascii_cstr(pe, blob, va, max_len=64):
    off = pe.get_offset_from_rva(va - pe.OPTIONAL_HEADER.ImageBase)
    raw = blob[off : off + max_len]
    end = raw.find(b"\x00")
    if end >= 0:
        raw = raw[:end]
    try:
        text = raw.decode("ascii")
    except UnicodeDecodeError:
        return None
    if text and all(31 < ord(ch) < 127 for ch in text):
        return text
    return None


def iter_calls(md, text_data, text_va, target):
    for insn in md.disasm(text_data, text_va):
        if (
            insn.mnemonic == "call"
            and insn.operands
            and insn.operands[0].type == X86_OP_IMM
            and insn.operands[0].imm == target
        ):
            yield insn.address


def first_signature_string(md, pe, blob, text_data, text_va, func_bounds):
    start, end = func_bounds
    code = text_data[start - text_va : end - text_va]
    for insn in md.disasm(code, start):
        if insn.mnemonic == "lea" and insn.operands and insn.operands[0].reg:
            for op in insn.operands[1:]:
                if op.type == X86_OP_MEM and op.mem.base == X86_REG_RIP:
                    va = insn.address + insn.size + op.mem.disp
                    text = read_ascii_cstr(pe, blob, va)
                    if text and text.startswith("L"):
                        return text, va
    return None, None


def main():
    if len(sys.argv) > 1:
        dll_path = pathlib.Path(sys.argv[1])
    else:
        dll_path = pathlib.Path(
            r"C:\Users\John\Documents\Testing\EvEJS\client\EVE\tq\bin64\_destiny.dll"
        )

    blob = dll_path.read_bytes()
    pe = pefile.PE(str(dll_path))
    base = pe.OPTIONAL_HEADER.ImageBase
    text = next(s for s in pe.sections if s.Name.rstrip(b"\x00") == b".text")
    text_data = text.get_data()
    text_va = base + text.VirtualAddress

    md = Cs(CS_ARCH_X86, CS_MODE_64)
    md.detail = True

    print(f"dll={dll_path}")
    print(f"image_base={base:#x}")
    print()

    for name, target in TARGETS.items():
        bounds = get_function_bounds(pe, target)
        print(f"[{name}] target={target:#x} bounds={bounds}")
        if not bounds:
            print()
            continue

        sig, sig_va = first_signature_string(md, pe, blob, text_data, text_va, bounds)
        if sig:
            print(f"  signature={sig!r} @ {sig_va:#x}")

        callers = list(iter_calls(md, text_data, text_va, target))
        if callers:
            print("  callers:")
            for caller in callers:
                caller_bounds = get_function_bounds(pe, caller)
                print(f"    {caller:#x} bounds={caller_bounds}")
        else:
            print("  callers: none")
        print()


if __name__ == "__main__":
    main()
