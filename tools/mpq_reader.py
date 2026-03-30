"""MPQ archive reader with encryption support for extracting WC3 map data."""
import struct
import zlib
import sys
import json


def make_crypt_table():
    table = [0] * 0x500
    seed = 0x00100001
    for i in range(0x100):
        index = i
        for j in range(5):
            seed = (seed * 125 + 3) % 0x2AAAAB
            temp1 = (seed & 0xFFFF) << 0x10
            seed = (seed * 125 + 3) % 0x2AAAAB
            temp2 = seed & 0xFFFF
            table[index] = temp1 | temp2
            index += 0x100
    return table


CT = make_crypt_table()


def hash_string(s, hash_type):
    s1 = 0x7FED7FED
    s2 = 0xEEEEEEEE
    for c in s.upper():
        c = ord(c)
        s1 = CT[hash_type * 0x100 + c] ^ ((s1 + s2) & 0xFFFFFFFF)
        s2 = (c + s1 + s2 + (s2 << 5) + 3) & 0xFFFFFFFF
    return s1 & 0xFFFFFFFF


def decrypt_data(data, key):
    s1 = key & 0xFFFFFFFF
    s2 = 0xEEEEEEEE
    result = bytearray()
    for i in range(0, len(data) - 3, 4):
        s2 = (s2 + CT[0x400 + (s1 & 0xFF)]) & 0xFFFFFFFF
        val = struct.unpack_from('<I', data, i)[0]
        val = (val ^ (s1 + s2)) & 0xFFFFFFFF
        s1 = ((~s1 << 0x15) + 0x11111111) | (s1 >> 0x0B)
        s1 &= 0xFFFFFFFF
        s2 = (val + s2 + (s2 << 5) + 3) & 0xFFFFFFFF
        result += struct.pack('<I', val)
    return bytes(result)


FLAG_IMPLODE   = 0x00000100
FLAG_COMPRESS  = 0x00000200
FLAG_ENCRYPTED = 0x00010000
FLAG_FIX_KEY   = 0x00020000
FLAG_SINGLE    = 0x01000000
FLAG_EXISTS    = 0x80000000


class MPQArchive:
    def __init__(self, path):
        with open(path, 'rb') as f:
            self.raw = f.read()

        # Parse header
        hdr_size, arc_size = struct.unpack_from('<II', self.raw, 4)
        fmt_ver, self.sector_shift = struct.unpack_from('<HH', self.raw, 12)
        ht_off, bt_off, self.ht_cnt, self.bt_cnt = struct.unpack_from('<IIII', self.raw, 16)
        self.sector_size = 512 << self.sector_shift

        # Decrypt hash table
        ht_raw = self.raw[ht_off : ht_off + self.ht_cnt * 16]
        self.ht_dec = decrypt_data(ht_raw, hash_string("(hash table)", 3))

        # Decrypt block table
        bt_raw = self.raw[bt_off : bt_off + self.bt_cnt * 16]
        self.bt_dec = decrypt_data(bt_raw, hash_string("(block table)", 3))

        # Parse block table
        self.blocks = []
        for i in range(self.bt_cnt):
            boff, bcsize, bfsize, bflags = struct.unpack_from('<IIII', self.bt_dec, i * 16)
            self.blocks.append((boff, bcsize, bfsize, bflags))

    def find_file(self, name):
        ha = hash_string(name, 1)
        hb = hash_string(name, 2)
        start = hash_string(name, 0) % self.ht_cnt
        for attempt in range(self.ht_cnt):
            idx = (start + attempt) % self.ht_cnt
            entry_ha, entry_hb = struct.unpack_from('<II', self.ht_dec, idx * 16)
            locale, platform, block_idx = struct.unpack_from('<HHI', self.ht_dec, idx * 16 + 8)
            if entry_ha == 0xFFFFFFFF and entry_hb == 0xFFFFFFFF:
                return None
            if entry_ha == ha and entry_hb == hb:
                if block_idx < self.bt_cnt:
                    return block_idx
        return None

    def read_file(self, name):
        bi = self.find_file(name)
        if bi is None:
            return None

        boff, bcsize, bfsize, bflags = self.blocks[bi]
        if not (bflags & FLAG_EXISTS):
            return None

        # File key for decryption
        base_name = name.replace("/", chr(92)).split(chr(92))[-1]
        file_key = hash_string(base_name, 3)
        if bflags & FLAG_FIX_KEY:
            file_key = (file_key + boff) ^ bfsize

        encrypted = bool(bflags & FLAG_ENCRYPTED)
        compressed = bool(bflags & (FLAG_COMPRESS | FLAG_IMPLODE))
        single_unit = bool(bflags & FLAG_SINGLE)

        file_data = self.raw[boff : boff + bcsize]

        if single_unit:
            if encrypted:
                file_data = decrypt_data(file_data, file_key)
            if compressed and bcsize < bfsize:
                comp_type = file_data[0]
                if comp_type == 2:
                    file_data = zlib.decompress(file_data[1:])
                elif comp_type == 0:
                    file_data = file_data[1:]
                else:
                    try:
                        file_data = zlib.decompress(file_data[1:])
                    except Exception:
                        file_data = zlib.decompress(file_data)
            return file_data[:bfsize]

        # Multi-sector file
        num_sectors = (bfsize + self.sector_size - 1) // self.sector_size
        sot_size = (num_sectors + 1) * 4
        sot_data = self.raw[boff : boff + sot_size]
        if encrypted:
            sot_data = decrypt_data(sot_data, file_key - 1)

        offsets = [struct.unpack_from('<I', sot_data, i * 4)[0] for i in range(num_sectors + 1)]

        result = bytearray()
        for s in range(num_sectors):
            s_start = boff + offsets[s]
            s_end = boff + offsets[s + 1]
            s_data = self.raw[s_start:s_end]
            s_expected = min(self.sector_size, bfsize - s * self.sector_size)

            if encrypted:
                s_data = decrypt_data(s_data, file_key + s)

            if compressed and len(s_data) < s_expected:
                comp_type = s_data[0]
                try:
                    if comp_type == 2:
                        s_data = zlib.decompress(s_data[1:])
                    elif comp_type == 0:
                        s_data = s_data[1:]
                    else:
                        s_data = zlib.decompress(s_data[1:])
                except Exception:
                    try:
                        s_data = zlib.decompress(s_data)
                    except Exception:
                        pass
            result.extend(s_data[:s_expected])

        return bytes(result[:bfsize])


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: mpq_reader.py <archive.w3x> [filename]")
        sys.exit(1)

    archive = MPQArchive(sys.argv[1])

    if len(sys.argv) >= 3:
        fname = sys.argv[2]
        data = archive.read_file(fname)
        if data:
            sys.stdout.buffer.write(data)
        else:
            print(f"File not found: {fname}", file=sys.stderr)
            sys.exit(1)
    else:
        # Try to list known WC3 map files
        known = [
            'war3mapUnits.doo', 'war3map.doo', 'war3map.w3i',
            'war3map.w3e', 'war3map.w3u', 'war3map.w3t',
            'war3map.wts', 'war3map.j', 'war3map.lua',
            'war3mapMisc.txt', '(listfile)',
        ]
        for fname in known:
            bi = archive.find_file(fname)
            if bi is not None:
                boff, bcsize, bfsize, bflags = archive.blocks[bi]
                flags = []
                if bflags & FLAG_ENCRYPTED: flags.append('ENC')
                if bflags & FLAG_COMPRESS: flags.append('CMP')
                if bflags & FLAG_FIX_KEY: flags.append('FIX')
                if bflags & FLAG_SINGLE: flags.append('SGL')
                print(f"{fname}: block={bi} size={bfsize} [{','.join(flags)}]")
