<?php
// Spike 10: what one collab save costs PHP in memory, with the real
// FramedPayload decoder. Run: php -d memory_limit=1G prototypes/ycsv/scripts/php-save-cost.php
// It mimics DocCollabDocumentService::put up to the disk write: read the body,
// decode the frame, hash the parts (sha1 sidecar etag, sha256 content etag).
declare(strict_types=1);

namespace App\Exceptions { class ApiHttpException extends \RuntimeException {} }

namespace {
require __DIR__ . '/../../../packages/api/app/Services/Collab/FramedPayload.php';
use App\Services\Collab\FramedPayload;

function frame(int $docLen, int $yjsLen): string {
    $header = json_encode(['documentLen' => $docLen, 'yjsLen' => $yjsLen]);
    return pack('n', strlen($header)) . $header . str_repeat('m', $docLen) . random_bytes($yjsLen);
}

function measure(string $label, callable $fn): void {
    gc_collect_cycles();
    memory_reset_peak_usage();
    $base = memory_get_usage();
    $t = hrtime(true);
    $fn();
    $ms = (hrtime(true) - $t) / 1e6;
    printf("%-58s peak +%6.1f MiB  %7.1f ms\n", $label, (memory_get_peak_usage() - $base) / 1048576, $ms);
}

foreach ([[256 * 1024, 1024 * 1024], [2 * 1048576, 5 * 1048576], [4 * 1048576, 20 * 1048576]] as [$doc, $yjs]) {
    $label = sprintf('framed PUT, text %.2f MiB + sidecar %.2f MiB', $doc / 1048576, $yjs / 1048576);
    measure($label, function () use ($doc, $yjs) {
        $body = frame($doc, $yjs);                 // $request->getContent()
        $p = FramedPayload::collaborationFields($body);
        $etag = sha1($p['yjs']);                   // storedSidecarEtag / recordSidecarLink
        $content = hash('sha256', $p['markdown']); // fileNodes->recordContentWrite
        $previous = str_repeat("\0", strlen($p['yjs'])); // readSidecarBytes($sidecarKey): previous sidecar kept for rollback
        unset($body, $p, $previous);
    });
}

// Notes PATCH sends the Yjs state as a JSON number[] (YjsBytes::decode).
foreach ([1 * 1048576, 5 * 1048576] as $n) {
    $json = '{"yjs":[' . implode(',', array_map(fn () => random_int(0, 255), range(1, $n))) . ']}';
    $label = sprintf('Notes PATCH JSON number[], %.0f MiB state (%.1f MiB body)', $n / 1048576, strlen($json) / 1048576);
    measure($label, function () use ($json) {
        $data = json_decode($json, true);
        $bytes = '';
        foreach ($data['yjs'] as $b) { $bytes .= chr($b); }
        unset($data, $bytes);
    });
    unset($json);
}
}
