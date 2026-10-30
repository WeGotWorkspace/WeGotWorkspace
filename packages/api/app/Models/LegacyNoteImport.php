<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

/**
 * One v0.1.96 `.notes/*.md` file that became a note (#1773).
 *
 * @property string $path_hash
 * @property string $source_path
 * @property string $note_uid
 * @property int $imported_at
 */
final class LegacyNoteImport extends Model
{
    use UsesWgwConnection;

    protected $table = 'notes_legacy_imports';

    protected $primaryKey = 'path_hash';

    protected $keyType = 'string';

    public $incrementing = false;

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'path_hash',
        'source_path',
        'note_uid',
        'imported_at',
    ];
}
