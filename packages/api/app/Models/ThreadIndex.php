<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

/**
 * One row per entry in a shared thread pool (#2173, docs/architecture/threads.md).
 * Listing a thread is one query on (pool, key, created_at, uid).
 *
 * @property int $id
 * @property string $uid
 * @property int $pool_calendarid
 * @property string $subject_type
 * @property string $subject_key
 * @property string $subject_scope
 * @property string $kind
 * @property string|null $parent_uid
 * @property string $author
 * @property string $created_at
 * @property int $modseq
 * @property string|null $activity_field
 */
final class ThreadIndex extends Model
{
    use UsesWgwConnection;

    public const KIND_COMMENT = 'comment';

    public const KIND_REPLY = 'reply';

    public const KIND_ACTIVITY = 'activity';

    protected $table = 'thread_index';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'uid',
        'pool_calendarid',
        'subject_type',
        'subject_key',
        'subject_scope',
        'kind',
        'parent_uid',
        'author',
        'created_at',
        'modseq',
        'activity_field',
    ];

    /** @var array<string, string> */
    protected $casts = [
        'pool_calendarid' => 'integer',
        'modseq' => 'integer',
    ];
}
