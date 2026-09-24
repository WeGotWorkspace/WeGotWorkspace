<?php

declare(strict_types=1);

namespace Tests\Unit\Rtc;

use App\Services\Rtc\RoomIdCodec;
use Tests\TestCase;

final class RoomIdCodecTest extends TestCase
{
    public function test_slash_and_no_slash_file_paths_encode_the_same_room_id(): void
    {
        $codec = new RoomIdCodec;
        $path = 'groups/administrators/team-notes.md';

        $this->assertSame($codec->encodeFilePath($path), $codec->encodeFilePath('/'.$path));
        $this->assertSame($path, $codec->decode($codec->encodeFilePath('/'.$path))['room']);
    }

    public function test_legacy_slashed_encoding_decodes_to_the_canonical_room(): void
    {
        $codec = new RoomIdCodec;
        $path = 'groups/administrators/team-notes.md';
        $legacy = 'f_'.rtrim(strtr(base64_encode('/'.$path), '+/', '-_'), '=');

        $decoded = $codec->decode($legacy);
        $this->assertSame('collab', $decoded['channel']);
        $this->assertSame($path, $decoded['room']);
        $this->assertNotSame($legacy, $codec->encodeFilePath($path));
    }

    public function test_note_uids_are_unchanged(): void
    {
        $codec = new RoomIdCodec;
        $uid = 'urn:uuid:550e8400-e29b-41d4-a716-446655440000';

        $this->assertSame($uid, $codec->decode($codec->encodeFilePath($uid))['room']);
    }
}
