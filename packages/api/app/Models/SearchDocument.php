<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property int $id
 * @property string $source_type
 * @property string|null $source_subtype
 * @property string $source_key
 * @property string|null $owner_username
 * @property string|null $group_slug
 * @property string|null $title
 * @property string|null $extension
 * @property string|null $category
 * @property string|null $content_type
 * @property int|null $size
 * @property int|null $created_at_ts
 * @property int|null $modified_at_ts
 * @property string|null $body_text
 * @property string|null $metadata_json
 * @property string $created_at
 * @property string $updated_at
 */
final class SearchDocument extends Model
{
    use UsesWgwConnection;

    protected $table = 'search_documents';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'source_type',
        'source_subtype',
        'source_key',
        'owner_username',
        'group_slug',
        'title',
        'extension',
        'category',
        'content_type',
        'size',
        'created_at_ts',
        'modified_at_ts',
        'body_text',
        'metadata_json',
        'created_at',
        'updated_at',
    ];

    /** @return HasMany<SearchTerm, $this> */
    public function terms(): HasMany
    {
        return $this->hasMany(SearchTerm::class, 'document_id');
    }
}
