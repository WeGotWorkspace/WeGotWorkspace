<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

final class JmapFileNodeMeta extends Model
{
    use UsesWgwConnection;

    protected $table = 'jmap_file_node_meta';

    public $timestamps = false;

    protected $fillable = ['seq', 'pruned_seq'];
}
