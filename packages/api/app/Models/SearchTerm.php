<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property int $id
 * @property int $document_id
 * @property string $token
 * @property string $field
 * @property int $weight
 * @property string $created_at
 * @property string $updated_at
 */
final class SearchTerm extends Model
{
    use UsesWgwConnection;

    protected $table = 'search_terms';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'document_id',
        'token',
        'field',
        'weight',
        'created_at',
        'updated_at',
    ];

    /** @return BelongsTo<SearchDocument, $this> */
    public function document(): BelongsTo
    {
        return $this->belongsTo(SearchDocument::class, 'document_id');
    }
}
