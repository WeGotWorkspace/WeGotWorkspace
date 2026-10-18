<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * `storage_key` is the document, not its sidecar.
 *
 * @property int $id
 * @property string $storage_key
 * @property string $storage_key_hash
 * @property string $content_etag
 * @property string $sidecar_etag
 */
final class DocYjsState extends Model
{
    use UsesWgwConnection;

    protected $table = 'doc_yjs_state';

    /** @var list<string> */
    protected $fillable = [
        'storage_key',
        'storage_key_hash',
        'content_etag',
        'sidecar_etag',
    ];
}
