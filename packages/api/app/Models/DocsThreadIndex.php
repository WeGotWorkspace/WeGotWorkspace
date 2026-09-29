<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Path index for Docs VJOURNAL threads — listing by X-WGW-DOC-PATH without
 * scanning every ICS blob in the owner's hidden pool.
 *
 * @property int $id
 * @property int $calendarid
 * @property string $uid
 * @property string $doc_path
 * @property string $kind
 * @property string|null $parent_uid
 * @property string|null $change_id
 */
final class DocsThreadIndex extends Model
{
    use UsesWgwConnection;

    public const KIND_COMMENT = 'comment';

    public const KIND_SUGGESTION = 'suggestion';

    public const KIND_REPLY = 'reply';

    protected $table = 'docs_thread_index';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'calendarid',
        'uid',
        'doc_path',
        'kind',
        'parent_uid',
        'change_id',
    ];

    /** @return BelongsTo<Calendar, $this> */
    public function calendar(): BelongsTo
    {
        return $this->belongsTo(Calendar::class, 'calendarid');
    }
}
