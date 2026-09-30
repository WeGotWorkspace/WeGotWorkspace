<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

/**
 * Legacy schema version audit ({@code app_migrations}) on upgraded installs.
 * Active migration tracking uses Laravel's {@code migrations} table on {@code wgw}.
 *
 * @property int $version
 * @property string $name
 * @property string $applied_at
 */
final class AppMigration extends Model
{
    use UsesWgwConnection;

    protected $table = 'app_migrations';

    protected $primaryKey = 'version';

    public $incrementing = false;

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'version',
        'name',
        'applied_at',
    ];

    public static function legacyMaxVersion(): int
    {
        return (int) (self::query()->max('version') ?? 0);
    }
}
